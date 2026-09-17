ALTER TYPE "public"."principle_created_by" ADD VALUE 'system_grounding_revalidation';--> statement-breakpoint
CREATE TABLE "strategy_evidence_grounding_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_principle_version_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"verdict" "grounding_verdict" NOT NULL,
	"reason" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_evidence_grounding_check_unique" UNIQUE("strategy_principle_version_id","evidence_id")
);
--> statement-breakpoint
ALTER TABLE "strategy_evidence_grounding_checks" ADD CONSTRAINT "strategy_evidence_grounding_checks_strategy_principle_version_id_strategy_principle_versions_id_fk" FOREIGN KEY ("strategy_principle_version_id") REFERENCES "public"."strategy_principle_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_evidence_grounding_checks" ADD CONSTRAINT "strategy_evidence_grounding_checks_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;