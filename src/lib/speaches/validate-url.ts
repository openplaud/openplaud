/**
 * Shared URL validation for Speaches API endpoints.
 * Centralizing here ensures security fixes are applied consistently.
 */

export const SPEACHES_DEFAULT_BASE_URL = "http://localhost:8000/v1";

/**
 * Returns true if the hostname is a known cloud metadata endpoint that
 * should be blocked to prevent SSRF attacks.
 * Handles plain hostnames, IPv4, IPv6-mapped IPv4 in both dotted-decimal
 * (::ffff:169.254.169.254) and hex-group (::ffff:a9fe:a9fe) notation.
 */
function isBlockedHostname(hostname: string): boolean {
    // Direct hostname / IPv4 checks
    if (hostname === "169.254.169.254") return true;
    if (hostname === "metadata.google.internal") return true;
    if (hostname === "100.100.100.200") return true;
    if (hostname === "192.0.0.192") return true;
    if (hostname.endsWith(".metadata.google.internal")) return true;

    // IPv6-mapped IPv4 in dotted-decimal form: ::ffff:169.254.169.254
    const ipv6DottedMatch = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv6DottedMatch) return isBlockedHostname(ipv6DottedMatch[1]);

    // IPv6-mapped IPv4 in hex-group form: ::ffff:a9fe:a9fe
    // Node.js normalizes [::ffff:169.254.169.254] to [::ffff:a9fe:a9fe],
    // and URL.hostname retains the brackets, so we strip them first.
    const strippedForHex =
        hostname.startsWith("[") && hostname.endsWith("]")
            ? hostname.slice(1, -1)
            : hostname;
    const ipv6HexMatch = strippedForHex.match(
        /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
    );
    if (ipv6HexMatch) {
        const hi = parseInt(ipv6HexMatch[1], 16);
        const lo = parseInt(ipv6HexMatch[2], 16);
        const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
        return isBlockedHostname(dotted);
    }

    return false;
}

/**
 * Validates a Speaches base URL for safety before making server-side requests.
 */
export function validateBaseUrl(baseUrl: string): {
    valid: boolean;
    error?: string;
} {
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return {
                valid: false,
                error: "Only HTTP and HTTPS URLs are allowed",
            };
        }
        if (parsed.username || parsed.password) {
            return {
                valid: false,
                error: "URLs with credentials are not allowed",
            };
        }
        // Note: URL.hostname retains brackets for IPv6 addresses in Node.js v20
        // (e.g. "[::ffff:a9fe:a9fe]"). isBlockedHostname handles all forms.
        if (isBlockedHostname(parsed.hostname)) {
            return {
                valid: false,
                error: "Cloud metadata endpoints are not allowed",
            };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: "Invalid URL" };
    }
}
