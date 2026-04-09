ALTER TABLE "user_settings" ADD COLUMN "summary_prompt" jsonb;
ALTER TABLE "ai_enhancements" ADD CONSTRAINT "ai_enhancements_recording_id_user_id_unique" UNIQUE("recording_id", "user_id");
