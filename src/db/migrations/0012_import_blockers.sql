CREATE TYPE "public"."corporate_action_kind" AS ENUM('stock_split');--> statement-breakpoint
CREATE TYPE "public"."corporate_action_source" AS ENUM('issuer_disclosure', 'broker_statement', 'user_declared');--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'tax_refund';--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"kind" "corporate_action_kind" NOT NULL,
	"effective_date" timestamp with time zone NOT NULL,
	"ratio_numerator" integer NOT NULL,
	"ratio_denominator" integer NOT NULL,
	"source" "corporate_action_source" NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_ratio_positive" CHECK ("corporate_actions"."ratio_numerator" > 0 AND "corporate_actions"."ratio_denominator" > 0)
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_actions_investor_ticker_effective_date_unique" ON "corporate_actions" USING btree ("investor_id","ticker","effective_date");