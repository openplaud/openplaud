import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { softDeleteRecording } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { clientIpFromHeaders } from "@/lib/admin/ip-allowlist";

export async function POST(request: Request) {
    const admin = await requireAdminMutation({
        route: "/api/admin/actions/soft-delete-recording",
        method: "POST",
    });
    const body = await request
        .json()
        .catch(() => ({}) as Record<string, unknown>);
    const recordingId =
        typeof body.recordingId === "string" ? body.recordingId : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!recordingId) {
        return NextResponse.json(
            { error: "recordingId required" },
            { status: 400 },
        );
    }

    try {
        const result = await softDeleteRecording(
            {
                adminUserId: admin.user.id,
                ip: clientIpFromHeaders(await nextHeaders()),
                reason,
            },
            recordingId,
        );
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "failed" },
            { status: 400 },
        );
    }
}
