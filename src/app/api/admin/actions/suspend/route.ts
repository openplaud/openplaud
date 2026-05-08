import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { suspendUser } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { clientIpFromHeaders } from "@/lib/admin/ip-allowlist";

export async function POST(request: Request) {
    const admin = await requireAdminMutation({
        route: "/api/admin/actions/suspend",
        method: "POST",
    });
    const body = await request
        .json()
        .catch(() => ({}) as Record<string, unknown>);
    const userId = typeof body.userId === "string" ? body.userId : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    try {
        const result = await suspendUser(
            {
                adminUserId: admin.user.id,
                ip: clientIpFromHeaders(await nextHeaders()),
                reason,
            },
            userId,
        );
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "failed" },
            { status: 400 },
        );
    }
}
