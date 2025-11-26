/// <reference lib="webworker" />

import { type PipelineType, pipeline } from "@xenova/transformers";

// Disable local model cache in browser
// @ts-expect-error
self.ONNX_CACHE = false;

let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null;

// Initialize the transcription pipeline
async function initTranscriber(model: string) {
    if (!transcriber) {
        transcriber = await pipeline(
            "automatic-speech-recognition" as PipelineType,
            model,
            {
                // Use CDN for models in browser
                revision: "main",
            },
        );
    }
    return transcriber;
}

// Listen for messages from the main thread
self.addEventListener("message", async (event) => {
    const { type, audioData, model } = event.data;

    if (type === "transcribe") {
        try {
            // Initialize transcriber with specified model
            const pipe = await initTranscriber(model);

            // Send progress updates
            self.postMessage({ type: "progress", status: "transcribing" });

            // Perform transcription
            const result = await (pipe as any)(audioData, {
                return_timestamps: false,
                chunk_length_s: 30,
                stride_length_s: 5,
            });

            // Send the result back to main thread
            self.postMessage({
                type: "complete",
                text: result.text,
                detectedLanguage: result.chunks?.[0]?.language || "en",
            });
        } catch (error) {
            self.postMessage({
                type: "error",
                error:
                    error instanceof Error
                        ? error.message
                        : "Transcription failed",
            });
        }
    }
});

// Signal that the worker is ready
self.postMessage({ type: "ready" });
