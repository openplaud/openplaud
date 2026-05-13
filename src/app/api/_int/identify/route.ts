import { proxyRybbitEvent } from "@/lib/rybbit/proxy";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    return proxyRybbitEvent(req, "identify");
}
