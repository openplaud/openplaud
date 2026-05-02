/**
 * Regression test for issue #59:
 *   "Disable registration"
 *
 * The `DISABLE_REGISTRATION` env var lets self-host operators lock down
 * sign-ups on a closed instance. The actual security boundary is
 * better-auth's `emailAndPassword.disableSignUp` option -- the /register
 * page guard and the /login register-link hide are UX layered on top.
 *
 * This test verifies the env-schema contract and the wiring into the
 * better-auth config object. NEXT_PHASE is set so importing env.ts skips
 * the runtime validation (DATABASE_URL etc) we don't need here.
 */

import { beforeAll, describe, expect, it } from "vitest";

type EnvSchema = typeof import("@/lib/env")["envSchema"];
let envSchema: EnvSchema;

beforeAll(async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    ({ envSchema } = await import("@/lib/env"));
});

describe("issue #59: DISABLE_REGISTRATION env contract", () => {
    it("defaults to false when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.DISABLE_REGISTRATION).toBe(false);
    });

    it("defaults to false for any string other than 'true'", () => {
        for (const v of ["false", "0", "1", "yes", "TRUE", "True", ""]) {
            const parsed = envSchema.parse({ DISABLE_REGISTRATION: v });
            expect(
                parsed.DISABLE_REGISTRATION,
                `value=${JSON.stringify(v)}`,
            ).toBe(false);
        }
    });

    it("is true only for the literal string 'true'", () => {
        const parsed = envSchema.parse({ DISABLE_REGISTRATION: "true" });
        expect(parsed.DISABLE_REGISTRATION).toBe(true);
    });
});
