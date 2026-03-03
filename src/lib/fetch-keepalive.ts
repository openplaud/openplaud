/**
 * HTTP POST helper with TCP keepalive enabled.
 *
 * Bun's built-in fetch() has an idle socket timeout (~5 min) that cannot be
 * disabled.  When a Speaches endpoint (e.g. diarization) processes for longer
 * than that without sending any data back, the connection is killed.
 *
 * This module uses node:http / node:https directly so we can call
 * socket.setKeepAlive(true, 30_000) -- sending TCP keepalive probes every
 * 30 seconds to prevent idle-connection timeouts at any layer (OS, Docker,
 * NAT, proxy).
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface KeepaliveResponse {
    status: number;
    ok: boolean;
    text(): Promise<string>;
    json(): Promise<unknown>;
}

/**
 * POST a FormData body to `url` with TCP keepalive probes every 30 s.
 * Returns a minimal Response-like object with status, ok, text(), json().
 */
export async function postFormData(
    url: string,
    formData: FormData,
    headers: Record<string, string> = {},
): Promise<KeepaliveResponse> {
    // Serialize FormData (including File blobs) into a multipart body.
    // new Response(formData) produces the correct Content-Type with boundary.
    const formResponse = new Response(formData);
    const contentType =
        formResponse.headers.get("content-type") ?? "application/octet-stream";
    const body = Buffer.from(await formResponse.arrayBuffer());

    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(
            `Unsupported protocol: ${parsed.protocol} — only http: and https: are allowed`,
        );
    }
    const isHttps = parsed.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    return new Promise<KeepaliveResponse>((resolve, reject) => {
        const req = requestFn(
            {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? "443" : "80"),
                path: parsed.pathname + parsed.search,
                method: "POST",
                headers: {
                    ...headers,
                    "Content-Type": contentType,
                    "Content-Length": String(body.length),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    const responseBody =
                        Buffer.concat(chunks).toString("utf-8");
                    const status = res.statusCode ?? 0;
                    resolve({
                        status,
                        ok: status >= 200 && status < 300,
                        text: async () => responseBody,
                        json: async () => JSON.parse(responseBody),
                    });
                });
                res.on("error", reject);
            },
        );

        // Enable TCP keepalive on the socket as soon as it connects.
        // This sends OS-level keepalive probes every 30 s, preventing
        // idle-connection timeouts from Docker, firewalls, NAT, etc.
        req.on("socket", (socket) => {
            socket.setKeepAlive(true, 30_000);
            socket.setTimeout(0); // disable Node's socket idle timeout
        });

        req.on("error", reject);
        req.write(body);
        req.end();
    });
}
