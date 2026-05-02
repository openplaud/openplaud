import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "./env";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
        usePlural: true,
    }),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        // Operator-controlled signup lockdown. When DISABLE_REGISTRATION=true,
        // better-auth's sign-up endpoint returns an error regardless of UI
        // state -- this is the actual security boundary. /register and /login
        // surface the same flag separately for UX. See issue #59.
        disableSignUp: env.DISABLE_REGISTRATION,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
});

export type Session = typeof auth.$Infer.Session;
