/**
 * Shared URL validation for Speaches API endpoints.
 * Centralizing here ensures security fixes are applied consistently across
 * both the models and registry routes.
 */

export const SPEACHES_DEFAULT_BASE_URL = "http://localhost:8000/v1";

/**
 * Validates a Speaches base URL for safety before making server-side requests.
 * Blocks cloud metadata endpoints to prevent SSRF attacks.
 * Localhost and private IPs are intentionally allowed since Speaches is a
 * self-hosted service.
 */
export function validateBaseUrl(baseUrl: string): {
    valid: boolean;
    error?: string;
} {
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return { valid: false, error: "Invalid URL scheme" };
        }
        // Reject URLs with embedded credentials to prevent auth header injection
        if (parsed.username || parsed.password) {
            return {
                valid: false,
                error: "URLs with credentials are not allowed",
            };
        }
        // Normalize hostname: URL.hostname retains brackets for IPv6 in Node.js.
        // Strip trailing dots — "metadata.google.internal." (with trailing dot)
        // is valid DNS syntax but bypasses simple string-equality blocklist checks.
        let hostname = parsed.hostname.replace(/\.+$/, "");
        if (hostname.startsWith("[") && hostname.endsWith("]")) {
            hostname = hostname.slice(1, -1);
        }
        // Resolve IPv6-mapped IPv4 addresses in both dotted-decimal and
        // hex-group notation (e.g. ::ffff:169.254.169.254 or ::ffff:a9fe:a9fe).
        // Node.js normalizes to hex groups so we must handle both forms.
        const ipv6DottedMatch = hostname.match(
            /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i,
        );
        if (ipv6DottedMatch) {
            hostname = ipv6DottedMatch[1];
        } else {
            const ipv6HexMatch = hostname.match(
                /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
            );
            if (ipv6HexMatch) {
                // Convert two 16-bit hex groups back to dotted-decimal IPv4
                const hi = parseInt(ipv6HexMatch[1], 16);
                const lo = parseInt(ipv6HexMatch[2], 16);
                hostname = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
            }
        }
        // Block known cloud metadata endpoints
        const blocklist = [
            "169.254.169.254", // AWS/Azure/GCP link-local metadata
            "metadata.google.internal", // GCP metadata
            "100.100.100.200", // Alibaba Cloud metadata
            "192.0.0.192", // Oracle Cloud metadata
            "fd00:ec2::254", // AWS IPv6 metadata endpoint
        ];
        if (
            blocklist.includes(hostname) ||
            hostname.endsWith(".metadata.google.internal")
        ) {
            return {
                valid: false,
                error: "Cloud metadata endpoints are not allowed",
            };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: "Invalid base URL" };
    }
}
