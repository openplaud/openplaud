CREATE TABLE "notion_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"database_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_save" boolean DEFAULT true NOT NULL,
	"default_tags" jsonb DEFAULT '["Knowledge"]'::jsonb,
	"include_action_items" boolean DEFAULT true NOT NULL,
	"include_summary" boolean DEFAULT true NOT NULL,
	"language" text DEFAULT 'nl' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notion_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN "api_base" text DEFAULT 'https://api.plaud.ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "notion_page_id" text;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "notion_page_url" text;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "notion_sync_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "notion_sync_error" text;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "notion_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "notion_config" ADD CONSTRAINT "notion_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;