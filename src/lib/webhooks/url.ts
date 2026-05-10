import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "@/lib/env";

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_16 = BigInt(16);
const IPV6_UNIQUE_LOCAL_PREFIX = BigInt(0x7e);
const IPV6_LINK_LOCAL_PREFIX = BigInt(0x3fa);
const IPV6_MULTICAST_PREFIX = BigInt(0xff);
const IPV6_DOCUMENTATION_PREFIX = BigInt(0x20010db8);

export type PublicWebhookAddress = {
    address: string;
    family: 4 | 6;
};

export type PublicWebhookTarget = {
    url: URL;
    addresses: PublicWebhookAddress[] | null;
};

export function webhookTargetsRequirePublic(): boolean {
    return env.WEBHOOKS_REQUIRE_PUBLIC_TARGETS ?? env.IS_HOSTED;
}

function assertHttpOrHttpsWebhookUrl(url: URL): void {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Webhook URL must use HTTP or HTTPS");
    }
}

function assertHttpsWebhookUrl(url: URL): void {
    if (url.protocol !== "https:") {
        throw new Error("Webhook URL must use HTTPS");
    }
}

export function parseWebhookUrl(value: unknown): string {
    if (typeof value !== "string") throw new Error("URL is required");

    const trimmed = value.trim();
    const url = new URL(trimmed);
    assertHttpOrHttpsWebhookUrl(url);
    if (url.username || url.password) {
        throw new Error("Webhook URL must not include credentials");
    }
    if (webhookTargetsRequirePublic()) {
        assertHttpsWebhookUrl(url);
        assertAllowedWebhookHostname(url.hostname);
    }
    return url.toString();
}

function normalizedHostname(hostname: string): string {
    const lower = hostname.toLowerCase().replace(/\.$/, "");
    if (lower.startsWith("[") && lower.endsWith("]")) {
        return lower.slice(1, -1);
    }
    return lower;
}

function parseIpv4(address: string): [number, number, number, number] | null {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    if (
        parts.length !== 4 ||
        parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
        return null;
    }
    return [parts[0], parts[1], parts[2], parts[3]];
}

function isPrivateIpv4(address: string): boolean {
    const parts = parseIpv4(address);
    if (!parts) return true;

    const [a, b, c] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0 && (c === 0 || c === 2)) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
    );
}

function mappedIpv4FromIpv6(address: string): string | null {
    const dottedIpv4 = address.includes(".")
        ? address.slice(address.lastIndexOf(":") + 1)
        : null;
    if (dottedIpv4 && parseIpv4(dottedIpv4)) return dottedIpv4;

    const tail = address.startsWith("::ffff:")
        ? address.slice("::ffff:".length)
        : address.startsWith("0:0:0:0:0:ffff:")
          ? address.slice("0:0:0:0:0:ffff:".length)
          : null;
    if (!tail) return null;

    const parts = tail.split(":");
    if (parts.length !== 2) return null;

    const high = Number.parseInt(parts[0], 16);
    const low = Number.parseInt(parts[1], 16);
    if (
        !Number.isInteger(high) ||
        !Number.isInteger(low) ||
        high < 0 ||
        high > 0xffff ||
        low < 0 ||
        low > 0xffff
    ) {
        return null;
    }

    return [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
    ].join(".");
}

function ipv6ToBigInt(address: string): bigint | null {
    if (address.includes(".")) return null;

    const parts = address.split("::");
    if (parts.length > 2) return null;

    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
    const zeroCount = parts.length === 2 ? 8 - left.length - right.length : 0;
    if (zeroCount < 0) return null;

    const hextets =
        parts.length === 2
            ? [...left, ...Array(zeroCount).fill("0"), ...right]
            : left;
    if (hextets.length !== 8) return null;

    let result = BIG_ZERO;
    for (const hextet of hextets) {
        if (!/^[0-9a-f]{1,4}$/i.test(hextet)) return null;
        const value = Number.parseInt(hextet, 16);
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
            return null;
        }
        result = (result << BIG_16) + BigInt(value);
    }
    return result;
}

function isPrivateIpv6(address: string): boolean {
    const normalized = address.toLowerCase().split("%", 1)[0];
    const mappedIpv4 = mappedIpv4FromIpv6(normalized);

    if (mappedIpv4) {
        return isPrivateIpv4(mappedIpv4);
    }
    const ip = ipv6ToBigInt(normalized);
    if (ip === null) return true;

    return (
        ip === BIG_ZERO ||
        ip === BIG_ONE ||
        ip >> BigInt(121) === IPV6_UNIQUE_LOCAL_PREFIX ||
        ip >> BigInt(118) === IPV6_LINK_LOCAL_PREFIX ||
        ip >> BigInt(120) === IPV6_MULTICAST_PREFIX ||
        ip >> BigInt(96) === IPV6_DOCUMENTATION_PREFIX
    );
}

function isPrivateIpAddress(address: string): boolean {
    const normalized = normalizedHostname(address);
    const ipVersion = isIP(normalized);
    if (ipVersion === 4) return isPrivateIpv4(normalized);
    if (ipVersion === 6) return isPrivateIpv6(normalized);
    return false;
}

function assertAllowedWebhookHostname(hostname: string): void {
    const normalized = normalizedHostname(hostname);
    if (
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        normalized.endsWith(".internal") ||
        normalized.endsWith(".home.arpa") ||
        normalized.endsWith(".lan") ||
        isPrivateIpAddress(normalized)
    ) {
        throw new Error("Webhook URL must use a public hostname or IP address");
    }
}

export function isWebhookUrlPolicyError(message: string): boolean {
    return (
        message === "URL is required" ||
        message === "Webhook URL must use HTTP or HTTPS" ||
        message === "Webhook URL must use HTTPS" ||
        message === "Webhook URL must not include credentials" ||
        message === "Webhook URL must use a public hostname or IP address" ||
        message === "Webhook URL must resolve to public IP addresses"
    );
}

export async function assertWebhookUrlAllowed(
    urlString: string,
): Promise<void> {
    await resolveWebhookUrl(urlString);
}

export async function resolveWebhookUrl(
    urlString: string,
): Promise<PublicWebhookTarget> {
    const url = new URL(parseWebhookUrl(urlString));
    if (!webhookTargetsRequirePublic()) {
        return {
            url,
            addresses: null,
        };
    }

    assertHttpsWebhookUrl(url);
    assertAllowedWebhookHostname(url.hostname);

    const hostname = normalizedHostname(url.hostname);
    const ipVersion = isIP(hostname);
    if (ipVersion === 4 || ipVersion === 6) {
        return {
            url,
            addresses: [{ address: hostname, family: ipVersion }],
        };
    }

    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await lookup(hostname, {
            all: true,
            verbatim: true,
        } as const);
    } catch {
        throw new Error("Webhook URL host could not be resolved");
    }

    if (addresses.length === 0) {
        throw new Error("Webhook URL host could not be resolved");
    }
    if (addresses.some((address) => isPrivateIpAddress(address.address))) {
        throw new Error("Webhook URL must resolve to public IP addresses");
    }

    return {
        url,
        addresses: addresses.map((address) => ({
            address: address.address,
            family: address.family === 6 ? 6 : 4,
        })),
    };
}
