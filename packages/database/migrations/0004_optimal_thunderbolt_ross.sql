ALTER TABLE "passenger_profiles" ADD COLUMN "average_rating" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "passenger_profiles" ADD COLUMN "ratings_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "ratings_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "passenger_profiles" ADD CONSTRAINT "passenger_profiles_ratings_count_non_negative_chk" CHECK ("passenger_profiles"."ratings_count" >= 0);--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_ratings_count_non_negative_chk" CHECK ("driver_profiles"."ratings_count" >= 0);