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
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
});

export type Session = typeof auth.$Infer.Session;
