-- Add unique constraint on (recording_id, user_id) for transcriptions.
-- This allows atomic upserts (INSERT ... ON CONFLICT DO UPDATE) and
-- prevents duplicate transcription rows for the same recording/user pair.
ALTER TABLE "transcriptions"
  ADD CONSTRAINT "transcriptions_recording_id_user_id_unique"
  UNIQUE ("recording_id", "user_id");
