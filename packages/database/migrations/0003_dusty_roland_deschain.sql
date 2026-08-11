ALTER TABLE "passenger_profiles" ADD COLUMN "default_test_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refund_reason" text;