CREATE TABLE "admin_action_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text,
	"admin_user_email" text NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_user_id" text,
	"target_resource_id" text,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text,
	"admin_user_email" text NOT NULL,
	"route" text NOT NULL,
	"method" varchar(10) NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "admin_action_log" ADD CONSTRAINT "admin_action_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_action_log_created_idx" ON "admin_action_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_action_log_target_user_idx" ON "admin_action_log" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_admin_created_idx" ON "admin_audit_log" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");