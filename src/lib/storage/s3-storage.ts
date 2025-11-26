import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Config, StorageProvider } from "./types";

/**
 * S3-compatible storage provider
 * Works with AWS S3, Cloudflare R2, MinIO, etc.
 */
export class S3Storage implements StorageProvider {
    private client: S3Client;
    private bucket: string;

    constructor(config: S3Config) {
        this.client = new S3Client({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            ...(config.endpoint && {
                endpoint: config.endpoint,
                forcePathStyle: true, // Required for some S3-compatible services
            }),
        });

        this.bucket = config.bucket;
    }

    async uploadFile(
        key: string,
        buffer: Buffer,
        contentType: string,
    ): Promise<string> {
        try {
            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
            });

            await this.client.send(command);
            return key;
        } catch (error) {
            throw new Error(
                `Failed to upload file to S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async downloadFile(key: string): Promise<Buffer> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            const response = await this.client.send(command);

            if (!response.Body) {
                throw new Error("Empty response body");
            }

            const chunks: Uint8Array[] = [];
            for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        } catch (error) {
            throw new Error(
                `Failed to download file from S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getSignedUrl(key: string, expiresIn: number): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            return await getSignedUrl(this.client, command, { expiresIn });
        } catch (error) {
            throw new Error(
                `Failed to generate signed URL: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteFile(key: string): Promise<void> {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            await this.client.send(command);
        } catch (error) {
            throw new Error(
                `Failed to delete file from S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const command = new HeadBucketCommand({
                Bucket: this.bucket,
            });

            await this.client.send(command);
            return true;
        } catch {
            return false;
        }
    }
}
