import { describe, expect, it, vi } from "vitest";
import {
    decrypt,
    decryptJSON,
    encrypt,
    encryptJSON,
    generateEncryptionKey,
} from "../lib/encryption";

vi.mock("../lib/env", () => ({
    env: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

describe("Encryption", () => {
    describe("encrypt/decrypt", () => {
        it("should encrypt and decrypt a simple string", () => {
            const plaintext = "Hello, World!";
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(encrypted).not.toBe(plaintext);
            expect(decrypted).toBe(plaintext);
        });

        it("should produce different ciphertexts for same plaintext", () => {
            const plaintext = "Same message";
            const encrypted1 = encrypt(plaintext);
            const encrypted2 = encrypt(plaintext);

            expect(encrypted1).not.toBe(encrypted2);
            expect(decrypt(encrypted1)).toBe(plaintext);
            expect(decrypt(encrypted2)).toBe(plaintext);
        });

        it("should handle empty string", () => {
            const plaintext = "";
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(decrypted).toBe("");
        });

        it("should handle long strings", () => {
            const plaintext = "A".repeat(10000);
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it("should handle special characters", () => {
            const plaintext = "Hello\n\t\r\"'世界🎉🚀";
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it("should throw error for invalid ciphertext format", () => {
            expect(() => decrypt("invalid")).toThrow(
                "Invalid ciphertext format",
            );
            expect(() => decrypt("a:b")).toThrow("Invalid ciphertext format");
        });

        it("should throw error for tampered ciphertext", () => {
            const encrypted = encrypt("test");
            const tampered = encrypted.replace(/[a-f0-9]/gi, (m) =>
                m === "a" ? "b" : "a",
            );
            expect(() => decrypt(tampered)).toThrow();
        });
    });

    describe("encryptJSON/decryptJSON", () => {
        it("should encrypt and decrypt JSON objects", () => {
            const data = { name: "John", age: 30, active: true };
            const encrypted = encryptJSON(data);
            const decrypted = decryptJSON<typeof data>(encrypted);

            expect(decrypted).toEqual(data);
        });

        it("should handle nested objects", () => {
            const data = {
                user: { name: "John", address: { city: "NYC" } },
                tags: ["admin", "user"],
            };
            const encrypted = encryptJSON(data);
            const decrypted = decryptJSON<typeof data>(encrypted);

            expect(decrypted).toEqual(data);
        });
    });

    describe("generateEncryptionKey", () => {
        it("should generate a valid 64-character hex key", () => {
            const key = generateEncryptionKey();

            expect(key).toHaveLength(64);
            expect(/^[0-9a-fA-F]+$/.test(key)).toBe(true);
        });

        it("should generate unique keys", () => {
            const key1 = generateEncryptionKey();
            const key2 = generateEncryptionKey();

            expect(key1).not.toBe(key2);
        });
    });
});
