CREATE TYPE "public"."prediction_kind" AS ENUM('forecast', 'reentry_condition');--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "kind" "prediction_kind";