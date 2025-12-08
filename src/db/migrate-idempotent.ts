import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const ADVISORY_LOCK_ID = 0x4f504c41;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_MS = 1_000;
const CONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isConnectionError = (error: unknown): boolean => {
    const msg = String((error as Error).message || "").toLowerCase();
    return [
        "connection",
        "timeout",
        "econnreset",
        "econnrefused",
        "etimedout",
    ].some((k) => msg.includes(k));
};

const connectWithRetry = async (): Promise<postgres.Sql> => {
    for (let i = 0; i <= CONNECT_DELAYS.length; i++) {
        try {
            // biome-ignore lint/style/noNonNullAssertion: needed for migration script
            const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
            await sql`SELECT 1`;
            return sql;
        } catch (error) {
            if (isConnectionError(error) && i < CONNECT_DELAYS.length) {
                console.log(
                    `⚠️ DB not ready, retry ${i + 1}/${CONNECT_DELAYS.length}...`,
                );
                await sleep(CONNECT_DELAYS[i]);
                continue;
            }
            throw error;
        }
    }
    throw new Error("Unreachable");
};

const acquireLock = async (sql: postgres.Sql): Promise<boolean> => {
    const start = Date.now();

    while (Date.now() - start < LOCK_TIMEOUT_MS) {
        const [{ acquired }] =
            await sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) as acquired`;
        if (acquired) return true;
        console.log("⏳ Waiting for migration lock...");
        await sleep(LOCK_POLL_MS);
    }

    return false;
};

const main = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not defined");
    }

    console.log("🔌 Connecting to database...");
    const sql = await connectWithRetry();

    console.log("🔒 Acquiring migration lock...");
    const acquired = await acquireLock(sql);

    if (!acquired) {
        console.log("✅ Lock timeout - another instance handled migrations");
        await sql.end();
        return;
    }

    try {
        console.log("⏳ Running migrations...");
        const start = Date.now();
        await migrate(drizzle(sql), {
            migrationsFolder: "./src/db/migrations",
        });
        console.log(`✅ Migrations completed in ${Date.now() - start}ms`);
    } finally {
        await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
        console.log("🔓 Lock released");
        await sql.end();
    }
};

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    });
