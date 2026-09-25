CREATE TYPE "public"."decision_statement_kind" AS ENUM('reasoning', 'risks', 'exit_conditions');--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_at_most_one_source";--> statement-breakpoint
ALTER TABLE "dna_hypothesis_versions" ADD COLUMN "provenance_json" jsonb;--> statement-breakpoint
ALTER TABLE "strategy_principle_versions" ADD COLUMN "provenance_json" jsonb;--> statement-breakpoint
ALTER TABLE "learning_insight_versions" ADD COLUMN "provenance_json" jsonb;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "decision_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "decision_statement_kind" "decision_statement_kind";--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_decision_statement_kind_iff" CHECK (("evidence"."decision_id" IS NULL) = ("evidence"."decision_statement_kind" IS NULL));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_at_most_one_source" CHECK (num_nonnulls("evidence"."transaction_id", "evidence"."interview_answer_id", "evidence"."decision_review_id", "evidence"."source_learning_insight_id", "evidence"."decision_id", "evidence"."manual_note_text") <= 1);