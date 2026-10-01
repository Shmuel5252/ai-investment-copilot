-- Unit 7C-B — Guided Interview PIT contract. Hand-completed: drizzle-kit
-- generated the NOT NULL column in one step, which cannot apply to a table
-- that already holds rows. The column is added nullable, every existing row
-- that has no provenance yet is backfilled from its session origin, and only
-- then the column is made NOT NULL.
-- question_text and answer_text are never touched.
CREATE TYPE "public"."interview_question_provenance" AS ENUM('guided_legacy', 'tell_me_why_legacy', 'guided_pit_ai', 'guided_pit_fallback', 'tell_me_why_pit');--> statement-breakpoint
ALTER TABLE "interview_answers" ADD COLUMN "question_provenance" "interview_question_provenance";--> statement-breakpoint
ALTER TABLE "interview_answers" ADD COLUMN "anchor_context" jsonb;--> statement-breakpoint
UPDATE "interview_answers" AS a SET "question_provenance" = CASE s."origin" WHEN 'guided_interview' THEN 'guided_legacy'::"interview_question_provenance" WHEN 'user_initiated' THEN 'tell_me_why_legacy'::"interview_question_provenance" END FROM "interview_sessions" AS s WHERE s."id" = a."interview_session_id" AND a."question_provenance" IS NULL;--> statement-breakpoint
ALTER TABLE "interview_answers" ALTER COLUMN "question_provenance" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_anchor_context_iff_pit" CHECK (("interview_answers"."anchor_context" IS NULL) = ("interview_answers"."question_provenance" IN ('guided_legacy', 'tell_me_why_legacy')));
