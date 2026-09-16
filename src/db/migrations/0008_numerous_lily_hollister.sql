CREATE TYPE "public"."grounding_verdict" AS ENUM('supported', 'unsupported');--> statement-breakpoint
ALTER TYPE "public"."dna_created_by" ADD VALUE 'system_grounding_revalidation';--> statement-breakpoint
CREATE TABLE "dna_evidence_grounding_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dna_hypothesis_version_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"verdict" "grounding_verdict" NOT NULL,
	"reason" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dna_evidence_grounding_check_unique" UNIQUE("dna_hypothesis_version_id","evidence_id")
);
--> statement-breakpoint
ALTER TABLE "dna_evidence_grounding_checks" ADD CONSTRAINT "dna_evidence_grounding_checks_dna_hypothesis_version_id_dna_hypothesis_versions_id_fk" FOREIGN KEY ("dna_hypothesis_version_id") REFERENCES "public"."dna_hypothesis_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dna_evidence_grounding_checks" ADD CONSTRAINT "dna_evidence_grounding_checks_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;