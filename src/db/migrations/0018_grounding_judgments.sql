CREATE TYPE "public"."grounding_planner_action" AS ENUM('no_op', 'checked_no_change', 'new_version');--> statement-breakpoint
CREATE TABLE "grounding_judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"dna_hypothesis_version_id" uuid,
	"strategy_principle_version_id" uuid,
	"evidence_id" uuid NOT NULL,
	"verdict" "grounding_verdict" NOT NULL,
	"reason" text NOT NULL,
	"context_supplied" boolean NOT NULL,
	"contract" text NOT NULL,
	"semantic_rule" text NOT NULL,
	"model" text NOT NULL,
	"code_version" text,
	"planner_action" "grounding_planner_action" NOT NULL,
	"resulting_dna_hypothesis_version_id" uuid,
	"resulting_strategy_principle_version_id" uuid,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grounding_judgment_run_evidence_unique" UNIQUE("run_id","evidence_id"),
	CONSTRAINT "grounding_judgment_one_judged_version" CHECK (num_nonnulls("grounding_judgments"."dna_hypothesis_version_id", "grounding_judgments"."strategy_principle_version_id") = 1),
	CONSTRAINT "grounding_judgment_resulting_iff_new_version" CHECK (("grounding_judgments"."planner_action" = 'new_version') = (num_nonnulls("grounding_judgments"."resulting_dna_hypothesis_version_id", "grounding_judgments"."resulting_strategy_principle_version_id") = 1)),
	CONSTRAINT "grounding_judgment_resulting_same_artifact" CHECK (("grounding_judgments"."resulting_dna_hypothesis_version_id" IS NULL OR ("grounding_judgments"."dna_hypothesis_version_id" IS NOT NULL AND "grounding_judgments"."resulting_dna_hypothesis_version_id" <> "grounding_judgments"."dna_hypothesis_version_id")) AND ("grounding_judgments"."resulting_strategy_principle_version_id" IS NULL OR ("grounding_judgments"."strategy_principle_version_id" IS NOT NULL AND "grounding_judgments"."resulting_strategy_principle_version_id" <> "grounding_judgments"."strategy_principle_version_id"))),
	CONSTRAINT "grounding_judgment_nonblank_run_metadata" CHECK (btrim("grounding_judgments"."contract") <> '' AND btrim("grounding_judgments"."semantic_rule") <> '' AND btrim("grounding_judgments"."model") <> '' AND btrim("grounding_judgments"."reason") <> '')
);
--> statement-breakpoint
ALTER TABLE "grounding_judgments" ADD CONSTRAINT "grounding_judgments_dna_version_fk" FOREIGN KEY ("dna_hypothesis_version_id") REFERENCES "public"."dna_hypothesis_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_judgments" ADD CONSTRAINT "grounding_judgments_strategy_version_fk" FOREIGN KEY ("strategy_principle_version_id") REFERENCES "public"."strategy_principle_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_judgments" ADD CONSTRAINT "grounding_judgments_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_judgments" ADD CONSTRAINT "grounding_judgments_resulting_dna_version_fk" FOREIGN KEY ("resulting_dna_hypothesis_version_id") REFERENCES "public"."dna_hypothesis_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_judgments" ADD CONSTRAINT "grounding_judgments_resulting_strategy_version_fk" FOREIGN KEY ("resulting_strategy_principle_version_id") REFERENCES "public"."strategy_principle_versions"("id") ON DELETE no action ON UPDATE no action;