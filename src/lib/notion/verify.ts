import { createNotionClientFromToken } from "./client";

interface VerifyResult {
    success: boolean;
    databaseTitle?: string;
    error?: string;
}

interface DatabaseProperty {
    type: string;
    name: string;
}

/**
 * Verify a Notion connection by testing the token and database access.
 * Uses raw (unencrypted) token for testing before saving.
 */
export async function verifyNotionConnection(
    token: string,
    databaseId: string,
): Promise<VerifyResult> {
    try {
        const client = createNotionClientFromToken(token);

        // Retrieve the database to verify access
        const database = await client.databases.retrieve({
            database_id: databaseId,
        });

        // Check if we got a full database response with properties
        if (!("properties" in database) || !database.properties) {
            return {
                success: false,
                error: "Could not retrieve full database details. Check integration permissions.",
            };
        }

        // Check required properties exist
        const properties = database.properties as Record<
            string,
            DatabaseProperty
        >;
        const hasTitle = Object.values(properties).some(
            (p) => p.type === "title",
        );
        const hasStatus = Object.values(properties).some(
            (p) => p.type === "status",
        );
        const hasTags = Object.values(properties).some(
            (p) =>
                p.type === "multi_select" &&
                p.name.toLowerCase() === "tags",
        );

        const missingProps: string[] = [];
        if (!hasTitle) missingProps.push("Name (title)");
        if (!hasStatus) missingProps.push("Status");
        if (!hasTags) missingProps.push("Tags (multi_select)");

        if (missingProps.length > 0) {
            return {
                success: false,
                error: `Database is missing required properties: ${missingProps.join(", ")}`,
            };
        }

        // Extract database title
        const titleParts =
            "title" in database
                ? (database.title as Array<{ plain_text: string }>)
                : [];
        const databaseTitle =
            titleParts.map((t) => t.plain_text).join("") || "Untitled";

        return {
            success: true,
            databaseTitle,
        };
    } catch (error) {
        if (error instanceof Error) {
            if (error.message.includes("Could not find database")) {
                return {
                    success: false,
                    error: "Database not found. Check the database ID and ensure the integration has access.",
                };
            }
            if (
                error.message.includes("API token is invalid") ||
                error.message.includes("Unauthorized")
            ) {
                return {
                    success: false,
                    error: "Invalid integration token. Check your Notion integration settings.",
                };
            }
            return {
                success: false,
                error: error.message,
            };
        }

        return {
            success: false,
            error: "Failed to connect to Notion",
        };
    }
}
