import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock env so importing PlaudClient (which transitively loads env via
// `proxy.ts`) doesn't trip the DATABASE_URL/ENCRYPTION_KEY runtime checks
// when running `pnpm test` without a populated .env.
const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: process.env.WEBSHARE_API_KEY,
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { PlaudClient } from "../lib/plaud/client";

const bearerToken = process.env.PLAUD_BEARER_TOKEN;
const hasToken = typeof bearerToken === "string" && bearerToken.length > 0;

if (!hasToken) {
    console.warn(
        "Skipping PlaudClient integration tests: PLAUD_BEARER_TOKEN not set.",
    );
}

const describeIntegration = hasToken ? describe : describe.skip;

describeIntegration("PlaudClient (integration)", () => {
    let client: PlaudClient;

    beforeAll(() => {
        client = new PlaudClient(bearerToken as string);
    });

    it("confirms the Plaud API connection is healthy", async () => {
        const result = await client.testConnection();
        expect(result).toBe(true);
    });

    it("lists devices with a success response", async () => {
        const response = await client.listDevices();
        expect(response.status).toBe(0);
        expect(Array.isArray(response.data_devices)).toBe(true);
    });

    it("fetches the latest recordings payload", async () => {
        const response = await client.getRecordings(0, 5, 0, "edit_time", true);
        expect(response.status).toBe(0);
        expect(Array.isArray(response.data_file_list)).toBe(true);
        expect(typeof response.data_file_total).toBe("number");
    });
});
