import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const ADVISORY_LOCK_ID = 0x4f504c41; // "OPLA" in hex (OpenPlaud)
const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRetryableError = (error: unknown): boolean => {
    const msg = String(
        (error as { message?: string }).message || "",
    ).toLowerCase();
    return (
        msg.includes("connection") ||
        msg.includes("timeout") ||
        msg.includes("econnreset") ||
        msg.includes("econnrefused") ||
        msg.includes("etimedout")
    );
};

const runMigrate = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not defined");
    }

    const connection = postgres(process.env.DATABASE_URL, { max: 1 });
    const db = drizzle(connection);

    console.log("🔒 Acquiring migration lock...");
    await connection`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`;

    try {
        console.log("⏳ Running migrations...");
        const start = Date.now();
        await migrate(db, { migrationsFolder: "./src/db/migrations" });
        console.log(`✅ Migrations completed in ${Date.now() - start}ms`);
    } finally {
        await connection`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
        console.log("🔓 Lock released");
        await connection.end();
    }
};

const runWithRetry = async () => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            await runMigrate();
            return;
        } catch (error) {
            if (isRetryableError(error) && attempt < MAX_RETRIES - 1) {
                const delay = RETRY_DELAYS[attempt];
                console.log(
                    `⚠ Attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
                );
                await sleep(delay);
                continue;
            }
            throw error;
        }
    }
};

runWithRetry()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    });
