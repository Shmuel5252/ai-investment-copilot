CREATE TYPE "public"."link_fact_verdict" AS ENUM('linked', 'independent');--> statement-breakpoint
ALTER TYPE "public"."dna_created_by" ADD VALUE 'system_independence_recalculation';--> statement-breakpoint
ALTER TYPE "public"."principle_created_by" ADD VALUE 'system_independence_recalculation';--> statement-breakpoint
CREATE TABLE "transaction_link_fact_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_link_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"verdict" "link_fact_verdict" NOT NULL,
	"shown_basis_json" jsonb,
	"note" text,
	"supersedes_fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dna_hypothesis_versions" ADD COLUMN "independence_basis_json" jsonb;--> statement-breakpoint
ALTER TABLE "strategy_principle_versions" ADD COLUMN "independence_basis_json" jsonb;--> statement-breakpoint
ALTER TABLE "transaction_link_fact_members" ADD CONSTRAINT "transaction_link_fact_members_fact_id_transaction_link_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."transaction_link_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_link_fact_members" ADD CONSTRAINT "transaction_link_fact_members_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_link_facts" ADD CONSTRAINT "transaction_link_facts_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_link_facts" ADD CONSTRAINT "transaction_link_facts_supersedes_fact_id_transaction_link_facts_id_fk" FOREIGN KEY ("supersedes_fact_id") REFERENCES "public"."transaction_link_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_link_fact_members_fact_transaction_unique" ON "transaction_link_fact_members" USING btree ("fact_id","transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_link_fact_members_transaction_id_idx" ON "transaction_link_fact_members" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_link_facts_supersedes_unique" ON "transaction_link_facts" USING btree ("supersedes_fact_id") WHERE "transaction_link_facts"."supersedes_fact_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transaction_link_facts_investor_id_idx" ON "transaction_link_facts" USING btree ("investor_id");