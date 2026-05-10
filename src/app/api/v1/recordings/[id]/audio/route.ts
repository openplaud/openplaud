import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { getAudioMimeType } from "@/lib/utils";
import {
    enforceV1AuthenticatedRateLimit,
    enforceV1IpRateLimit,
} from "@/lib/v1/rate-limit";

type IdContext = { params: Promise<{ id: string }> };

export const GET = apiHandler<IdContext>(async (request, context) => {
    const ipLimitResponse = await enforceV1IpRateLimit(request);
    if (ipLimitResponse) return ipLimitResponse;

    const authn = await authenticateRequest(request);
    if (!authn) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized", 401);
    }

    const authLimitResponse = await enforceV1AuthenticatedRateLimit(authn);
    if (authLimitResponse) return authLimitResponse;

    const { id } = await (context as IdContext).params;
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, authn.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
            { id },
        );
    }

    const storage = await createUserStorageProvider(authn.user.id);

    if (recording.storageType === "s3") {
        const signedUrl = await storage.getSignedUrl(
            recording.storagePath,
            300,
        );
        return NextResponse.redirect(signedUrl, 302);
    }

    const audioBuffer = await storage.downloadFile(recording.storagePath);
    const contentType = getAudioMimeType(recording.storagePath);
    const fileSize = audioBuffer.length;
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (rangeMatch) {
            const start = Number.parseInt(rangeMatch[1], 10);
            // RFC 7233: clamp an oversized end to fileSize - 1 rather than
            // 416. Only an unsatisfiable start (past EOF or > end) is 416.
            const requestedEnd = rangeMatch[2]
                ? Number.parseInt(rangeMatch[2], 10)
                : fileSize - 1;
            const end = Math.min(requestedEnd, fileSize - 1);

            if (start < 0 || start >= fileSize || start > end) {
                return NextResponse.json(
                    {
                        error: "Invalid range",
                        code: ErrorCode.INVALID_INPUT,
                        details: { range: rangeHeader, fileSize },
                    },
                    {
                        status: 416,
                        headers: {
                            "Content-Range": `bytes */${fileSize}`,
                        },
                    },
                );
            }

            const chunk = audioBuffer.slice(start, end + 1);
            const chunkSize = end - start + 1;

            return new NextResponse(new Uint8Array(chunk), {
                status: 206,
                headers: {
                    "Content-Type": contentType,
                    "Content-Length": chunkSize.toString(),
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "private, max-age=300",
                },
            });
        }
    }

    return new NextResponse(new Uint8Array(audioBuffer), {
        headers: {
            "Content-Type": contentType,
            "Content-Length": fileSize.toString(),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300",
        },
    });
});
