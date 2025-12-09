ALTER TABLE "user_settings" ADD COLUMN "bark_notifications" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "bark_push_key" text;--> statement-breakpoint