ALTER TABLE "api_credentials" ADD COLUMN IF NOT EXISTS "streaming_enabled" boolean NOT NULL DEFAULT true;
