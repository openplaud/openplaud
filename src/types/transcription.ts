/**
 * Transcription types
 */

export interface DiarizedSegment {
    speaker: string;
    text: string;
    start?: number;
    end?: number;
}

export interface TranscriptionResult {
    text: string;
    detectedLanguage: string;
}

export type TranscriptionModel =
    | "whisper-tiny"
    | "whisper-base"
    | "whisper-small";
