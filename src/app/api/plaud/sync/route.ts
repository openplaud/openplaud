import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth-server";
import { createErrorResponse, ErrorCode } from "@/lib/errors";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

export async function POST(request: Request) {
    try {
        const sessionResult = await getApiSession(request);
        if (!sessionResult.session) return sessionResult.response;
        const session = sessionResult.session;

        const result = await syncRecordingsForUser(session.user.id);

        return NextResponse.json({
            success: true,
            newRecordings: result.newRecordings,
            updatedRecordings: result.updatedRecordings,
            errors: result.errors,
        });
    } catch (error) {
        console.error("Error syncing recordings:", error);
        const response = createErrorResponse(error, ErrorCode.PLAUD_API_ERROR);
        return NextResponse.json(response.body, { status: response.status });
    }
}
