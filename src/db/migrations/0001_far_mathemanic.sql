ALTER TABLE "strategy_principle_versions" ADD COLUMN "evidence_strength" "evidence_strength";--> statement-breakpoint
ALTER TABLE "strategy_principle_versions" ADD COLUMN "supporting_evidence_count" integer;--> statement-breakpoint
ALTER TABLE "strategy_principle_versions" ADD COLUMN "contradicting_evidence_count" integer;