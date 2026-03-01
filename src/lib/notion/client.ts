import { Client } from "@notionhq/client";
import { decrypt } from "@/lib/encryption";

/**
 * Create a Notion client from an encrypted token
 */
export function createNotionClient(encryptedToken: string): Client {
    const token = decrypt(encryptedToken);
    return new Client({ auth: token });
}

/**
 * Create a Notion client from a raw (unencrypted) token
 */
export function createNotionClientFromToken(token: string): Client {
    return new Client({ auth: token });
}
