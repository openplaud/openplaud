import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import { isBuild } from "@/lib/utils";
import * as schema from "./schema";

if (!env.DATABASE_URL && !isBuild) {
    throw new Error(
        "DATABASE_URL must be set in non-build runtime (dev/prod server)",
    );
}

export const db = env.DATABASE_URL
    ? drizzle(postgres(env.DATABASE_URL), { schema })
    : ({} as ReturnType<typeof drizzle<typeof schema>>);

export { schema };
