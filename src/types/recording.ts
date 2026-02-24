import type { InferSelectModel } from "drizzle-orm";
import type { recordings } from "@/db/schema";

export type RecordingQueryResult = Pick<
    InferSelectModel<typeof recordings>,
    "id" | "filename" | "duration" | "startTime" | "filesize" | "deviceSn" | "plaudFileId"
>;

export type Recording = Omit<RecordingQueryResult, "startTime"> & {
    startTime: string;
};

// Helper to serialize a recording query result
export function serializeRecording(recording: RecordingQueryResult): Recording {
    return {
        ...recording,
        startTime: recording.startTime.toISOString(),
    };
}
