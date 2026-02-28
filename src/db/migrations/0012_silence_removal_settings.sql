ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "silence_threshold_db" integer NOT NULL DEFAULT -40;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "silence_duration_seconds" real NOT NULL DEFAULT 1.0;
