CREATE TYPE "public"."cancelled_by_actor" AS ENUM('PASSENGER', 'DRIVER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."document_review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'PROFILE_PHOTO');--> statement-breakpoint
CREATE TYPE "public"."driver_availability_status" AS ENUM('OFFLINE', 'ONLINE', 'BUSY');--> statement-breakpoint
CREATE TYPE "public"."driver_onboarding_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('PENDING', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."promo_discount_type" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."rating_direction" AS ENUM('PASSENGER_TO_DRIVER', 'DRIVER_TO_PASSENGER');--> statement-breakpoint
CREATE TYPE "public"."ride_event_actor_type" AS ENUM('PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."ride_request_status" AS ENUM('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'PASSENGER_ONBOARD', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('PASSENGER', 'DRIVER', 'ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase_chk" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "passenger_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"license_number" text NOT NULL,
	"license_state" text NOT NULL,
	"license_expires_at" timestamp with time zone,
	"onboarding_status" "driver_onboarding_status" DEFAULT 'DRAFT' NOT NULL,
	"availability_status" "driver_availability_status" DEFAULT 'OFFLINE' NOT NULL,
	"average_rating" numeric(3, 2),
	"total_rides" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_total_rides_non_negative_chk" CHECK ("driver_profiles"."total_rides" >= 0),
	CONSTRAINT "driver_profiles_availability_requires_approval_chk" CHECK ("driver_profiles"."availability_status" = 'OFFLINE' OR "driver_profiles"."onboarding_status" = 'APPROVED')
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"color" text NOT NULL,
	"license_plate" text NOT NULL,
	"vin" text,
	"seats" integer NOT NULL,
	"status" "vehicle_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_year_plausible_chk" CHECK ("vehicles"."year" BETWEEN 1980 AND 2100),
	CONSTRAINT "vehicles_seats_positive_chk" CHECK ("vehicles"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"review_status" "document_review_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"status" "ride_status" DEFAULT 'REQUESTED' NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_lat" double precision NOT NULL,
	"pickup_lng" double precision NOT NULL,
	"destination_address" text NOT NULL,
	"destination_lat" double precision NOT NULL,
	"destination_lng" double precision NOT NULL,
	"estimated_distance_meters" integer,
	"estimated_duration_seconds" integer,
	"estimated_fare_cents" integer,
	"actual_distance_meters" integer,
	"actual_duration_seconds" integer,
	"final_fare_cents" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "cancelled_by_actor",
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rides_pickup_lat_range_chk" CHECK ("rides"."pickup_lat" BETWEEN -90 AND 90),
	CONSTRAINT "rides_pickup_lng_range_chk" CHECK ("rides"."pickup_lng" BETWEEN -180 AND 180),
	CONSTRAINT "rides_destination_lat_range_chk" CHECK ("rides"."destination_lat" BETWEEN -90 AND 90),
	CONSTRAINT "rides_destination_lng_range_chk" CHECK ("rides"."destination_lng" BETWEEN -180 AND 180),
	CONSTRAINT "rides_estimated_fare_non_negative_chk" CHECK ("rides"."estimated_fare_cents" IS NULL OR "rides"."estimated_fare_cents" >= 0),
	CONSTRAINT "rides_final_fare_non_negative_chk" CHECK ("rides"."final_fare_cents" IS NULL OR "rides"."final_fare_cents" >= 0),
	CONSTRAINT "rides_estimated_distance_non_negative_chk" CHECK ("rides"."estimated_distance_meters" IS NULL OR "rides"."estimated_distance_meters" >= 0),
	CONSTRAINT "rides_actual_distance_non_negative_chk" CHECK ("rides"."actual_distance_meters" IS NULL OR "rides"."actual_distance_meters" >= 0),
	CONSTRAINT "rides_cancelled_fields_consistent_chk" CHECK (("rides"."cancelled_at" IS NULL AND "rides"."cancelled_by" IS NULL) OR ("rides"."cancelled_at" IS NOT NULL AND "rides"."cancelled_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ride_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" "ride_request_status" DEFAULT 'OFFERED' NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"previous_status" "ride_status",
	"new_status" "ride_status" NOT NULL,
	"actor_type" "ride_event_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"latitude" double precision,
	"longitude" double precision,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"heading" real,
	"speed" real,
	"accuracy" real,
	"recorded_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_locations_lat_range_chk" CHECK ("driver_locations"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "driver_locations_lng_range_chk" CHECK ("driver_locations"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "ride_location_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"heading" real,
	"speed" real,
	"accuracy" real,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_location_samples_lat_range_chk" CHECK ("ride_location_samples"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "ride_location_samples_lng_range_chk" CHECK ("ride_location_samples"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"rater_user_id" uuid NOT NULL,
	"ratee_user_id" uuid NOT NULL,
	"direction" "rating_direction" NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_stars_range_chk" CHECK ("ratings"."stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_payment_intent_id" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_amount_non_negative_chk" CHECK ("payment_records"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "driver_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"gross_fare_cents" integer NOT NULL,
	"platform_commission_cents" integer NOT NULL,
	"driver_gross_earnings_cents" integer NOT NULL,
	"adjustments_cents" integer DEFAULT 0 NOT NULL,
	"payout_status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_earnings_gross_fare_non_negative_chk" CHECK ("driver_earnings"."gross_fare_cents" >= 0),
	CONSTRAINT "driver_earnings_commission_non_negative_chk" CHECK ("driver_earnings"."platform_commission_cents" >= 0),
	CONSTRAINT "driver_earnings_driver_gross_non_negative_chk" CHECK ("driver_earnings"."driver_gross_earnings_cents" >= 0),
	CONSTRAINT "driver_earnings_balance_chk" CHECK ("driver_earnings"."driver_gross_earnings_cents" = "driver_earnings"."gross_fare_cents" - "driver_earnings"."platform_commission_cents")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"is_internal_note" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ride_id" uuid,
	"subject" text NOT NULL,
	"status" "support_ticket_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" "promo_discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_discount_value_non_negative_chk" CHECK ("promo_codes"."discount_value" >= 0),
	CONSTRAINT "promo_codes_percentage_range_chk" CHECK ("promo_codes"."discount_type" <> 'PERCENTAGE' OR "promo_codes"."discount_value" <= 100),
	CONSTRAINT "promo_codes_redeemed_count_non_negative_chk" CHECK ("promo_codes"."redeemed_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "pricing_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_fare_cents" integer NOT NULL,
	"per_mile_rate_cents" integer NOT NULL,
	"per_minute_rate_cents" integer NOT NULL,
	"minimum_fare_cents" integer NOT NULL,
	"booking_fee_cents" integer NOT NULL,
	"cancellation_fee_cents" integer NOT NULL,
	"platform_commission_percentage" numeric(5, 2) NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_configs_commission_range_chk" CHECK ("pricing_configs"."platform_commission_percentage" BETWEEN 0 AND 100),
	CONSTRAINT "pricing_configs_base_fare_non_negative_chk" CHECK ("pricing_configs"."base_fare_cents" >= 0),
	CONSTRAINT "pricing_configs_per_mile_non_negative_chk" CHECK ("pricing_configs"."per_mile_rate_cents" >= 0),
	CONSTRAINT "pricing_configs_per_minute_non_negative_chk" CHECK ("pricing_configs"."per_minute_rate_cents" >= 0),
	CONSTRAINT "pricing_configs_minimum_fare_non_negative_chk" CHECK ("pricing_configs"."minimum_fare_cents" >= 0),
	CONSTRAINT "pricing_configs_booking_fee_non_negative_chk" CHECK ("pricing_configs"."booking_fee_cents" >= 0),
	CONSTRAINT "pricing_configs_cancellation_fee_non_negative_chk" CHECK ("pricing_configs"."cancellation_fee_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "passenger_profiles" ADD CONSTRAINT "passenger_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_passenger_id_passenger_profiles_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."passenger_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_location_samples" ADD CONSTRAINT "ride_location_samples_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_user_id_users_id_fk" FOREIGN KEY ("rater_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_user_id_users_id_fk" FOREIGN KEY ("ratee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "passenger_profiles_user_id_key" ON "passenger_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_profiles_user_id_key" ON "driver_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_profiles_license_number_key" ON "driver_profiles" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "driver_profiles_onboarding_status_idx" ON "driver_profiles" USING btree ("onboarding_status");--> statement-breakpoint
CREATE INDEX "driver_profiles_availability_status_idx" ON "driver_profiles" USING btree ("availability_status");--> statement-breakpoint
CREATE INDEX "vehicles_driver_id_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_license_plate_key" ON "vehicles" USING btree ("license_plate");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles" USING btree ("vin");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_one_active_per_driver_key" ON "vehicles" USING btree ("driver_id") WHERE "vehicles"."is_active" = true;--> statement-breakpoint
CREATE INDEX "driver_documents_driver_id_idx" ON "driver_documents" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_documents_review_status_idx" ON "driver_documents" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "driver_documents_expires_at_idx" ON "driver_documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rides_passenger_id_idx" ON "rides" USING btree ("passenger_id");--> statement-breakpoint
CREATE INDEX "rides_driver_id_idx" ON "rides" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "rides_status_idx" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rides_requested_at_idx" ON "rides" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "ride_requests_ride_id_idx" ON "ride_requests" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_requests_driver_id_idx" ON "ride_requests" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "ride_requests_status_idx" ON "ride_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ride_requests_open_offer_idx" ON "ride_requests" USING btree ("ride_id","driver_id") WHERE "ride_requests"."status" = 'OFFERED';--> statement-breakpoint
CREATE INDEX "ride_events_ride_id_idx" ON "ride_events" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_events_created_at_idx" ON "ride_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_locations_driver_id_key" ON "driver_locations" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "ride_location_samples_ride_id_idx" ON "ride_location_samples" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_location_samples_recorded_at_idx" ON "ride_location_samples" USING btree ("recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_ride_direction_key" ON "ratings" USING btree ("ride_id","direction");--> statement-breakpoint
CREATE INDEX "ratings_ratee_user_id_idx" ON "ratings" USING btree ("ratee_user_id");--> statement-breakpoint
CREATE INDEX "payment_records_ride_id_idx" ON "payment_records" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "payment_records_status_idx" ON "payment_records" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_idempotency_key_key" ON "payment_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_provider_payment_intent_id_key" ON "payment_records" USING btree ("provider_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_earnings_ride_id_key" ON "driver_earnings" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "driver_earnings_driver_id_idx" ON "driver_earnings" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_earnings_payout_status_idx" ON "driver_earnings" USING btree ("payout_status");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "support_messages_ticket_id_idx" ON "support_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_ride_id_idx" ON "support_tickets" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_configs_name_key" ON "pricing_configs" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_configs_one_active_key" ON "pricing_configs" USING btree ("active") WHERE "pricing_configs"."active" = true;