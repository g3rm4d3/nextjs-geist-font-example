CREATE TYPE "public"."background_check_status" AS ENUM('PENDING', 'PASSED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."document_review_status" ADD VALUE 'REPLACEMENT_REQUESTED';--> statement-breakpoint
CREATE TABLE "background_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" "background_check_status" DEFAULT 'PENDING' NOT NULL,
	"provider_report_id" text,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_checks_driver_id_idx" ON "background_checks" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "background_checks_status_idx" ON "background_checks" USING btree ("status");