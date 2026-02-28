ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "split_segment_minutes" integer NOT NULL DEFAULT 60;
