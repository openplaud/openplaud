import type {
    PlaudApiError,
    PlaudDeviceListResponse,
    PlaudRecordingsResponse,
    PlaudTempUrlResponse,
} from "@/types/plaud";
import { DEFAULT_SERVER_KEY, PLAUD_SERVERS } from "./servers";

export interface PlaudUpdateFilenameResponse {
    status: number;
    msg: string;
    data_file?: unknown;
}

export const DEFAULT_PLAUD_API_BASE = PLAUD_SERVERS[DEFAULT_SERVER_KEY].apiBase;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Plaud API Client
 * Handles all communication with Plaud API
 */
/**
 * Optional callback invoked when the client detects a 401 and needs a fresh
 * access token. Should attempt a refresh and return the new plaintext token,
 * or throw if refresh is not possible.
 */
export type TokenRefresher = () => Promise<string>;

export class PlaudClient {
    private bearerToken: string;
    private apiBase: string;
    private refreshToken?: TokenRefresher;

    constructor(
        bearerToken: string,
        apiBase: string = DEFAULT_PLAUD_API_BASE,
        options?: {
            refreshToken?: TokenRefresher;
        },
    ) {
        this.bearerToken = bearerToken;
        this.apiBase = apiBase;
        this.refreshToken = options?.refreshToken;
    }

    /**
     * Make authenticated request to Plaud API with retry logic
     */
    private async request<T>(
        endpoint: string,
        options?: RequestInit,
        retryCount = 0,
    ): Promise<T> {
        const url = `${this.apiBase}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...options?.headers,
                    Authorization: `Bearer ${this.bearerToken}`,
                    "Content-Type": "application/json",
                },
            });

            // Token expired — attempt refresh once
            if (
                response.status === 401 &&
                retryCount === 0 &&
                this.refreshToken
            ) {
                try {
                    const newToken = await this.refreshToken();
                    this.bearerToken = newToken;
                    return this.request<T>(endpoint, options, retryCount + 1);
                } catch {
                    // Refresh failed — fall through to throw the 401 error
                }
            }

            if (response.status === 429 && retryCount < MAX_RETRIES) {
                const retryAfter = response.headers.get("Retry-After");
                const delay = retryAfter
                    ? Number.parseInt(retryAfter, 10) * 1000
                    : INITIAL_RETRY_DELAY * 2 ** retryCount; // Exponential backoff
                await sleep(delay);
                return this.request<T>(endpoint, options, retryCount + 1);
            }

            if (!response.ok) {
                const error = (await response.json()) as PlaudApiError;
                const errorMessage = `Plaud API error (${response.status}): ${error.msg || response.statusText}`;

                if (
                    response.status >= 500 &&
                    response.status < 600 &&
                    retryCount < MAX_RETRIES
                ) {
                    const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                    await sleep(delay);
                    return this.request<T>(endpoint, options, retryCount + 1);
                }

                throw new Error(errorMessage);
            }

            return (await response.json()) as T;
        } catch (error) {
            if (
                error instanceof TypeError &&
                error.message.includes("fetch") &&
                retryCount < MAX_RETRIES
            ) {
                const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                await sleep(delay);
                return this.request<T>(endpoint, options, retryCount + 1);
            }

            if (error instanceof Error) {
                throw error;
            }
            throw new Error(
                `Failed to make request to Plaud API: ${String(error)}`,
            );
        }
    }

    /**
     * List all devices associated with the account
     */
    async listDevices(): Promise<PlaudDeviceListResponse> {
        return this.request<PlaudDeviceListResponse>("/device/list");
    }

    /**
     * Get all recordings
     * @param skip - Number of recordings to skip
     * @param limit - Maximum number of recordings to return
     * @param isTrash - Whether to get trashed recordings (0 = active, 1 = trash)
     * @param sortBy - Field to sort by (default: edit_time)
     * @param isDesc - Sort in descending order (default: true)
     */
    async getRecordings(
        skip: number = 0,
        limit: number = 99999,
        isTrash: number = 0,
        sortBy: string = "edit_time",
        isDesc: boolean = true,
    ): Promise<PlaudRecordingsResponse> {
        const params = new URLSearchParams({
            skip: skip.toString(),
            limit: limit.toString(),
            is_trash: isTrash.toString(),
            sort_by: sortBy,
            is_desc: isDesc.toString(),
        });

        return this.request<PlaudRecordingsResponse>(
            `/file/simple/web?${params.toString()}`,
        );
    }

    /**
     * Get temporary URL for downloading audio file
     * @param fileId - The recording file ID
     * @param isOpus - Whether to get OPUS format URL (default: true)
     */
    async getTempUrl(
        fileId: string,
        isOpus: boolean = true,
    ): Promise<PlaudTempUrlResponse> {
        const params = new URLSearchParams({
            is_opus: isOpus ? "1" : "0",
        });

        return this.request<PlaudTempUrlResponse>(
            `/file/temp-url/${fileId}?${params.toString()}`,
        );
    }

    /**
     * Download audio file as buffer
     * @param fileId - The recording file ID
     * @param preferOpus - Whether to prefer OPUS format (smaller size)
     */
    async downloadRecording(
        fileId: string,
        preferOpus: boolean = true,
    ): Promise<Buffer> {
        try {
            const tempUrlResponse = await this.getTempUrl(fileId, preferOpus);
            const downloadUrl =
                preferOpus && tempUrlResponse.temp_url_opus
                    ? tempUrlResponse.temp_url_opus
                    : tempUrlResponse.temp_url;

            const response = await fetch(downloadUrl);
            if (!response.ok) {
                throw new Error(
                    `Failed to download file: ${response.statusText}`,
                );
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            throw new Error(
                `Failed to download recording: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Test connection to Plaud API
     * Returns true if bearer token is valid
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.listDevices();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Update filename for a recording
     * @param fileId - The recording file ID
     * @param filename - New filename to set
     */
    async updateFilename(
        fileId: string,
        filename: string,
    ): Promise<PlaudUpdateFilenameResponse> {
        return this.request<PlaudUpdateFilenameResponse>(`/file/${fileId}`, {
            method: "PATCH",
            body: JSON.stringify({ filename }),
        });
    }
}

/**
 * Create Plaud client from encrypted bearer token.
 *
 * If an encrypted refresh token and a connection ID are provided,
 * the client will automatically attempt a token refresh on 401
 * and persist the new access token back to the database.
 */
export async function createPlaudClient(
    encryptedToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
    refreshContext?: {
        encryptedRefreshToken: string;
        connectionId: string;
    },
): Promise<PlaudClient> {
    const { decrypt, encrypt } = await import("../encryption");
    const bearerToken = decrypt(encryptedToken);

    let refresher: TokenRefresher | undefined;

    if (refreshContext?.encryptedRefreshToken) {
        refresher = async () => {
            const { plaudRefreshAccessToken } = await import("./auth");
            const { db } = await import("@/db");
            const { plaudConnections } = await import("@/db/schema");
            const { eq } = await import("drizzle-orm");

            const plainRefresh = decrypt(refreshContext.encryptedRefreshToken);
            const newAccessToken = await plaudRefreshAccessToken(
                plainRefresh,
                apiBase,
            );

            // Persist the new access token
            await db
                .update(plaudConnections)
                .set({
                    bearerToken: encrypt(newAccessToken),
                    updatedAt: new Date(),
                })
                .where(eq(plaudConnections.id, refreshContext.connectionId));

            return newAccessToken;
        };
    }

    return new PlaudClient(bearerToken, apiBase, { refreshToken: refresher });
}

export * from "./types";
