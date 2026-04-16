import { OpenAI } from "openai";
import type { CliConfig } from "./config";

export const DEFAULT_WHISPER_MODEL = "whisper-1";

/**
 * Transcribe an audio buffer using the OpenAI-compatible Whisper API.
 *
 * Works with any OpenAI-compatible provider:
 * - OpenAI (default): whisper-1
 * - Groq (free): whisper-large-v3 at https://api.groq.com/openai/v1
 * - Together AI, OpenRouter, local Ollama, etc.
 */
export async function transcribeAudio(
    audioBuffer: Buffer,
    config: CliConfig,
    options?: {
        language?: string;
        filename?: string;
    },
): Promise<string> {
    if (!config.whisperApiKey) {
        throw new Error(
            "No Whisper API key configured. Run `openplaud auth` to set one up.",
        );
    }

    const client = new OpenAI({
        apiKey: config.whisperApiKey,
        ...(config.whisperBaseUrl && { baseURL: config.whisperBaseUrl }),
    });

    const model = config.whisperModel || DEFAULT_WHISPER_MODEL;
    const filename = options?.filename || "recording.mp3";

    // Detect content type from buffer magic bytes
    const contentType = detectAudioType(audioBuffer);

    const file = new File([new Uint8Array(audioBuffer)], filename, {
        type: contentType,
    });

    const response = await client.audio.transcriptions.create({
        file,
        model,
        ...(options?.language && { language: options.language }),
    });

    return response.text;
}

/**
 * Detect audio format from file magic bytes.
 */
function detectAudioType(buffer: Buffer): string {
    // OGG/Opus: starts with "OggS"
    if (
        buffer.length >= 4 &&
        buffer[0] === 0x4f &&
        buffer[1] === 0x67 &&
        buffer[2] === 0x67 &&
        buffer[3] === 0x53
    ) {
        return "audio/ogg";
    }

    // MP3: starts with ID3 tag or MPEG sync word
    if (buffer.length >= 3) {
        if (
            buffer[0] === 0x49 &&
            buffer[1] === 0x44 &&
            buffer[2] === 0x33 // ID3
        ) {
            return "audio/mpeg";
        }
        if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
            // MPEG sync
            return "audio/mpeg";
        }
    }

    // WAV: starts with "RIFF"
    if (
        buffer.length >= 4 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46
    ) {
        return "audio/wav";
    }

    // Default to MP3 (Plaud mostly serves MP3)
    return "audio/mpeg";
}
