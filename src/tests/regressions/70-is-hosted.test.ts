/**
 * Regression test for issue #70:
 *   "Add IS_HOSTED flag to gate marketing surfaces on self-host"
 *
 * Default behavior is self-host (IS_HOSTED=false): the marketing landing
 * page at `/` should not be served, and logged-out visitors are redirected
 * to /login. Only the OpenPlaud-operated hosted instance sets IS_HOSTED=true
 * to render Hero / Pricing / FinalCTA / etc.
 *
 * This test verifies the env-schema contract: IS_HOSTED parses string-boolean
 * correctly with a `false` default. The page-level redirect in src/app/page.tsx
 * branches directly on `env.IS_HOSTED`; if this contract holds, the redirect
 * does too.
 *
 * NEXT_PHASE is set so importing env.ts does not run the runtime validation
 * (DATABASE_URL etc) -- we only need the schema here. Restored in afterAll
 * so other tests sharing the worker aren't affected.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type EnvSchema = typeof import("@/lib/env")["envSchema"];
let envSchema: EnvSchema;
let originalNextPhase: string | undefined;

beforeAll(async () => {
    originalNextPhase = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    ({ envSchema } = await import("@/lib/env"));
});

afterAll(() => {
    if (originalNextPhase === undefined) {
        delete process.env.NEXT_PHASE;
    } else {
        process.env.NEXT_PHASE = originalNextPhase;
    }
});

describe("issue #70: IS_HOSTED env contract", () => {
    it("defaults to false when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.IS_HOSTED).toBe(false);
    });

    it("defaults to false for any string other than 'true'", () => {
        for (const v of ["false", "0", "1", "yes", "no", "TRUE", "True", ""]) {
            const parsed = envSchema.parse({ IS_HOSTED: v });
            expect(parsed.IS_HOSTED, `value=${JSON.stringify(v)}`).toBe(false);
        }
    });

    it("is true only for the literal string 'true'", () => {
        const parsed = envSchema.parse({ IS_HOSTED: "true" });
        expect(parsed.IS_HOSTED).toBe(true);
    });
});
