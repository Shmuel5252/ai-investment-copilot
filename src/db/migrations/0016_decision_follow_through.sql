CREATE TYPE "public"."execution_fact_verdict" AS ENUM('executed', 'unrelated');--> statement-breakpoint
CREATE TABLE "decision_execution_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"verdict" "execution_fact_verdict" NOT NULL,
	"shown_basis_json" jsonb,
	"note" text,
	"supersedes_fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_execution_facts_no_self_supersession" CHECK ("decision_execution_facts"."supersedes_fact_id" IS NULL OR "decision_execution_facts"."supersedes_fact_id" <> "decision_execution_facts"."id")
);
--> statement-breakpoint
ALTER TABLE "investment_cases" ADD COLUMN "origin_prediction_id" uuid;--> statement-breakpoint
ALTER TABLE "decision_execution_facts" ADD CONSTRAINT "decision_execution_facts_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_execution_facts" ADD CONSTRAINT "decision_execution_facts_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_execution_facts" ADD CONSTRAINT "decision_execution_facts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_execution_facts" ADD CONSTRAINT "decision_execution_facts_supersedes_fact_id_decision_execution_facts_id_fk" FOREIGN KEY ("supersedes_fact_id") REFERENCES "public"."decision_execution_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_execution_facts_root_pair_unique" ON "decision_execution_facts" USING btree ("decision_id","transaction_id") WHERE "decision_execution_facts"."supersedes_fact_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_execution_facts_supersedes_unique" ON "decision_execution_facts" USING btree ("supersedes_fact_id") WHERE "decision_execution_facts"."supersedes_fact_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "decision_execution_facts_decision_id_idx" ON "decision_execution_facts" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decision_execution_facts_transaction_id_idx" ON "decision_execution_facts" USING btree ("transaction_id");--> statement-breakpoint
ALTER TABLE "investment_cases" ADD CONSTRAINT "investment_cases_origin_prediction_id_predictions_id_fk" FOREIGN KEY ("origin_prediction_id") REFERENCES "public"."predictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_cases_origin_prediction_unique" ON "investment_cases" USING btree ("origin_prediction_id") WHERE "investment_cases"."origin_prediction_id" IS NOT NULL;