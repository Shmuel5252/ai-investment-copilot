CREATE TYPE "public"."added_by" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('researching', 'decided', 'archived');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('pending', 'led_to_new_review', 'led_to_new_version', 'noted');--> statement-breakpoint
CREATE TYPE "public"."cost_basis_confidence" AS ENUM('known', 'approximate', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."decision_quality" AS ENUM('insufficient_evidence', 'weak', 'reasonable', 'strong');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('BUY', 'PASS', 'HOLD', 'ADD', 'REDUCE', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."dna_created_by" AS ENUM('ai_generated', 'user_correction');--> statement-breakpoint
CREATE TYPE "public"."dna_hypothesis_status" AS ENUM('active', 'user_rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_stance" AS ENUM('supporting', 'contradicting');--> statement-breakpoint
CREATE TYPE "public"."evidence_strength" AS ENUM('insufficient_evidence', 'weak', 'moderate', 'strong');--> statement-breakpoint
CREATE TYPE "public"."idea_source" AS ENUM('user_manual');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interview_session_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."market_data_type" AS ENUM('quote', 'profile', 'historical_price');--> statement-breakpoint
CREATE TYPE "public"."prediction_status" AS ENUM('pending', 'confirmed', 'refuted', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."principle_created_by" AS ENUM('user_declared', 'ai_observed', 'system_default');--> statement-breakpoint
CREATE TYPE "public"."principle_type" AS ENUM('declared', 'observed', 'validated');--> statement-breakpoint
CREATE TYPE "public"."review_dimension_name" AS ENUM('thesis_quality', 'evidence_quality', 'risk_awareness', 'valuation_awareness', 'portfolio_fit', 'strategy_consistency', 'exit_conditions');--> statement-breakpoint
CREATE TYPE "public"."thesis_accuracy" AS ENUM('confirmed', 'partially_confirmed', 'refuted', 'inconclusive', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('csv_import', 'manual_entry');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'fee');--> statement-breakpoint
CREATE TABLE "investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investors_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "market_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"index_level" numeric,
	"index_change_1d" numeric,
	"index_change_1m" numeric,
	"sector_performance_json" jsonb,
	"volatility_index_value" numeric,
	"source" text NOT NULL,
	"raw_data_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_data_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"data_type" "market_data_type" NOT NULL,
	"payload_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer NOT NULL,
	"status" "import_batch_status" DEFAULT 'processing' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_opening_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"quantity" numeric NOT NULL,
	"cost_basis_per_share" numeric,
	"cost_basis_confidence" "cost_basis_confidence" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"ticker" text,
	"transaction_type" "transaction_type" NOT NULL,
	"quantity" numeric,
	"price" numeric,
	"amount" numeric NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"source" "transaction_source" NOT NULL,
	"import_batch_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dna_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"status" "dna_hypothesis_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dna_hypothesis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dna_hypothesis_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"statement_text" text NOT NULL,
	"evidence_strength" "evidence_strength" NOT NULL,
	"supporting_evidence_count" integer DEFAULT 0 NOT NULL,
	"contradicting_evidence_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" "dna_created_by" NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "strategy_principle_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_principle_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"principle_type" "principle_type" NOT NULL,
	"statement_text" text NOT NULL,
	"rationale_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" "principle_created_by" NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "strategy_principles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_version_principles" (
	"strategy_version_id" uuid NOT NULL,
	"strategy_principle_version_id" uuid NOT NULL,
	CONSTRAINT "strategy_version_principles_strategy_version_id_strategy_principle_version_id_pk" PRIMARY KEY("strategy_version_id","strategy_principle_version_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_summary" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_insight_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learning_insight_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"statement_text" text NOT NULL,
	"decision_quality_pattern_json" jsonb,
	"thesis_accuracy_pattern_json" jsonb,
	"evidence_strength" "evidence_strength" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" "dna_created_by" NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "learning_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"family" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_session_id" uuid NOT NULL,
	"transaction_id" uuid,
	"question_text" text NOT NULL,
	"answer_text" text NOT NULL,
	"supersedes_answer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" "interview_session_status" DEFAULT 'in_progress' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"note_text" text NOT NULL,
	"source" "idea_source" DEFAULT 'user_manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_to_case_id" uuid
);
--> statement-breakpoint
CREATE TABLE "investment_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"idea_id" uuid,
	"status" "case_status" DEFAULT 'researching' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market_intelligence_json" jsonb,
	"market_intelligence_fetched_at" timestamp with time zone,
	"personal_fit_text" text,
	"personal_fit_evidence_refs" jsonb,
	"portfolio_fit_text" text,
	"bull_case_text" text,
	"bear_case_text" text,
	"catalysts_text" text,
	"invalidation_conditions_text" text,
	"market_blindspot_text" text,
	"devils_advocate_text" text,
	"synthesis_text" text
);
--> statement-breakpoint
CREATE TABLE "decision_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"review_date" timestamp with time zone DEFAULT now() NOT NULL,
	"narrative_summary_text" text NOT NULL,
	"decision_quality_overall" "decision_quality" NOT NULL,
	"thesis_accuracy" "thesis_accuracy" NOT NULL,
	"outcome_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_snapshot_dna_references" (
	"decision_snapshot_id" uuid NOT NULL,
	"dna_hypothesis_version_id" uuid NOT NULL,
	CONSTRAINT "decision_snapshot_dna_references_decision_snapshot_id_dna_hypothesis_version_id_pk" PRIMARY KEY("decision_snapshot_id","dna_hypothesis_version_id")
);
--> statement-breakpoint
CREATE TABLE "decision_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"price_at_decision" numeric NOT NULL,
	"size" numeric,
	"user_reasoning_text" text NOT NULL,
	"ai_realtime_assessment_text" text,
	"risks_considered_text" text,
	"exit_conditions_text" text,
	"portfolio_state_json" jsonb NOT NULL,
	"market_context_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"thesis_id" uuid NOT NULL,
	"investment_case_snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_snapshots_decision_id_unique" UNIQUE("decision_id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"investment_case_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"decision_type" "decision_type" NOT NULL,
	"decision_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "later_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"text" text NOT NULL,
	"added_by" "added_by" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"claim_text" text NOT NULL,
	"checkable_by_date" timestamp with time zone,
	"status" "prediction_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_review_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_review_id" uuid NOT NULL,
	"dimension" "review_dimension_name" NOT NULL,
	"verdict" "decision_quality" NOT NULL,
	"rationale_text" text NOT NULL,
	"cited_snapshot_fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_text" text NOT NULL,
	"ai_interpretation_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dna_hypothesis_id" uuid,
	"strategy_principle_id" uuid,
	"learning_insight_id" uuid,
	"stance" "evidence_stance" NOT NULL,
	"transaction_id" uuid,
	"interview_answer_id" uuid,
	"decision_review_id" uuid,
	"manual_note_text" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_exactly_one_subject" CHECK (num_nonnulls("evidence"."dna_hypothesis_id", "evidence"."strategy_principle_id", "evidence"."learning_insight_id") = 1),
	CONSTRAINT "evidence_at_most_one_source" CHECK (num_nonnulls("evidence"."transaction_id", "evidence"."interview_answer_id", "evidence"."decision_review_id", "evidence"."manual_note_text") <= 1)
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_dimension_id" uuid,
	"decision_review_id" uuid,
	"dna_hypothesis_id" uuid,
	"strategy_principle_id" uuid,
	"learning_insight_id" uuid,
	"user_argument_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "correction_status" DEFAULT 'pending' NOT NULL,
	"resulting_review_id" uuid,
	"resulting_version_id" uuid,
	CONSTRAINT "correction_exactly_one_target" CHECK (num_nonnulls("corrections"."review_dimension_id", "corrections"."decision_review_id", "corrections"."dna_hypothesis_id", "corrections"."strategy_principle_id", "corrections"."learning_insight_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_opening_states" ADD CONSTRAINT "portfolio_opening_states_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dna_hypotheses" ADD CONSTRAINT "dna_hypotheses_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dna_hypothesis_versions" ADD CONSTRAINT "dna_hypothesis_versions_dna_hypothesis_id_dna_hypotheses_id_fk" FOREIGN KEY ("dna_hypothesis_id") REFERENCES "public"."dna_hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_principle_versions" ADD CONSTRAINT "strategy_principle_versions_strategy_principle_id_strategy_principles_id_fk" FOREIGN KEY ("strategy_principle_id") REFERENCES "public"."strategy_principles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_principles" ADD CONSTRAINT "strategy_principles_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_version_principles" ADD CONSTRAINT "strategy_version_principles_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_version_principles" ADD CONSTRAINT "strategy_version_principles_strategy_principle_version_id_strategy_principle_versions_id_fk" FOREIGN KEY ("strategy_principle_version_id") REFERENCES "public"."strategy_principle_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_insight_versions" ADD CONSTRAINT "learning_insight_versions_learning_insight_id_learning_insights_id_fk" FOREIGN KEY ("learning_insight_id") REFERENCES "public"."learning_insights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_insights" ADD CONSTRAINT "learning_insights_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_interview_session_id_interview_sessions_id_fk" FOREIGN KEY ("interview_session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_supersedes_answer_id_interview_answers_id_fk" FOREIGN KEY ("supersedes_answer_id") REFERENCES "public"."interview_answers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_promoted_to_case_id_investment_cases_id_fk" FOREIGN KEY ("promoted_to_case_id") REFERENCES "public"."investment_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cases" ADD CONSTRAINT "investment_cases_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cases" ADD CONSTRAINT "investment_cases_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_reviews" ADD CONSTRAINT "decision_reviews_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshot_dna_references" ADD CONSTRAINT "decision_snapshot_dna_references_decision_snapshot_id_decision_snapshots_id_fk" FOREIGN KEY ("decision_snapshot_id") REFERENCES "public"."decision_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshot_dna_references" ADD CONSTRAINT "decision_snapshot_dna_references_dna_hypothesis_version_id_dna_hypothesis_versions_id_fk" FOREIGN KEY ("dna_hypothesis_version_id") REFERENCES "public"."dna_hypothesis_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_market_context_id_market_contexts_id_fk" FOREIGN KEY ("market_context_id") REFERENCES "public"."market_contexts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_investment_case_id_investment_cases_id_fk" FOREIGN KEY ("investment_case_id") REFERENCES "public"."investment_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "later_contexts" ADD CONSTRAINT "later_contexts_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_resolved_by_review_id_decision_reviews_id_fk" FOREIGN KEY ("resolved_by_review_id") REFERENCES "public"."decision_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_dimensions" ADD CONSTRAINT "review_dimensions_decision_review_id_decision_reviews_id_fk" FOREIGN KEY ("decision_review_id") REFERENCES "public"."decision_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_dna_hypothesis_id_dna_hypotheses_id_fk" FOREIGN KEY ("dna_hypothesis_id") REFERENCES "public"."dna_hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_strategy_principle_id_strategy_principles_id_fk" FOREIGN KEY ("strategy_principle_id") REFERENCES "public"."strategy_principles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_learning_insight_id_learning_insights_id_fk" FOREIGN KEY ("learning_insight_id") REFERENCES "public"."learning_insights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_interview_answer_id_interview_answers_id_fk" FOREIGN KEY ("interview_answer_id") REFERENCES "public"."interview_answers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_decision_review_id_decision_reviews_id_fk" FOREIGN KEY ("decision_review_id") REFERENCES "public"."decision_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_review_dimension_id_review_dimensions_id_fk" FOREIGN KEY ("review_dimension_id") REFERENCES "public"."review_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_decision_review_id_decision_reviews_id_fk" FOREIGN KEY ("decision_review_id") REFERENCES "public"."decision_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_dna_hypothesis_id_dna_hypotheses_id_fk" FOREIGN KEY ("dna_hypothesis_id") REFERENCES "public"."dna_hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_strategy_principle_id_strategy_principles_id_fk" FOREIGN KEY ("strategy_principle_id") REFERENCES "public"."strategy_principles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_learning_insight_id_learning_insights_id_fk" FOREIGN KEY ("learning_insight_id") REFERENCES "public"."learning_insights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_resulting_review_id_decision_reviews_id_fk" FOREIGN KEY ("resulting_review_id") REFERENCES "public"."decision_reviews"("id") ON DELETE no action ON UPDATE no action;