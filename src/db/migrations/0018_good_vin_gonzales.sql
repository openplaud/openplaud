ALTER TABLE "transcriptions" ALTER COLUMN "text" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "transcriptions" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "error_message" text;