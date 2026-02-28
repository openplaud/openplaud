ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "filename_modified" boolean NOT NULL DEFAULT false;
