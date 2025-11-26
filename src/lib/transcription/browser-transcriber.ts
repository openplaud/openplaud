/**
 * Browser-based transcription using Transformers.js
 * Runs Whisper models in the browser via WebAssembly
 */

import type {
    TranscriptionModel,
    TranscriptionResult,
} from "@/types/transcription";

export type { TranscriptionModel, TranscriptionResult };

const MODEL_MAP: Record<TranscriptionModel, string> = {
    "whisper-tiny": "Xenova/whisper-tiny",
    "whisper-base": "Xenova/whisper-base",
    "whisper-small": "Xenova/whisper-small",
};

export class BrowserTranscriber {
    private worker: Worker | null = null;
    private isReady = false;

    /**
     * Initialize the transcription worker
     */
    async initialize(): Promise<void> {
        if (this.worker) {
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                this.worker = new Worker(
                    new URL("./worker.ts", import.meta.url),
                    { type: "module" },
                );

                this.worker.addEventListener("message", (event) => {
                    if (event.data.type === "ready") {
                        this.isReady = true;
                        resolve();
                    }
                });

                this.worker.addEventListener("error", (error) => {
                    reject(
                        new Error(
                            `Worker initialization failed: ${error.message}`,
                        ),
                    );
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Transcribe audio file using the browser-based model
     */
    async transcribe(
        audioFile: File,
        model: TranscriptionModel = "whisper-base",
        onProgress?: (status: string) => void,
    ): Promise<TranscriptionResult> {
        if (!this.worker || !this.isReady) {
            throw new Error(
                "Transcriber not initialized. Call initialize() first.",
            );
        }

        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error("Worker not available"));
                return;
            }

            const reader = new FileReader();

            reader.onload = async () => {
                if (!this.worker) {
                    reject(new Error("Worker not available"));
                    return;
                }

                const audioData = reader.result;
                const modelPath = MODEL_MAP[model];

                const messageHandler = (event: MessageEvent) => {
                    const { type, text, detectedLanguage, error, status } =
                        event.data;

                    if (type === "progress" && onProgress) {
                        onProgress(status);
                    } else if (type === "complete") {
                        this.worker?.removeEventListener(
                            "message",
                            messageHandler,
                        );
                        resolve({ text, detectedLanguage });
                    } else if (type === "error") {
                        this.worker?.removeEventListener(
                            "message",
                            messageHandler,
                        );
                        reject(new Error(error));
                    }
                };

                this.worker.addEventListener("message", messageHandler);

                this.worker.postMessage({
                    type: "transcribe",
                    audioData,
                    model: modelPath,
                });
            };

            reader.onerror = () => {
                reject(new Error("Failed to read audio file"));
            };

            reader.readAsArrayBuffer(audioFile);
        });
    }

    /**
     * Clean up the worker
     */
    terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}

/**
 * Convenience function to transcribe audio in the browser
 */
export async function transcribeInBrowser(
    audioFile: File,
    model: TranscriptionModel = "whisper-base",
    onProgress?: (status: string) => void,
): Promise<TranscriptionResult> {
    const transcriber = new BrowserTranscriber();
    try {
        await transcriber.initialize();
        return await transcriber.transcribe(audioFile, model, onProgress);
    } finally {
        transcriber.terminate();
    }
}
