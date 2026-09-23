ALTER TABLE "decision_reviews" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "decision_reviews" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "decision_reviews" ADD COLUMN "input_state_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_reviews_decision_idempotency_key_unique" ON "decision_reviews" USING btree ("decision_id","idempotency_key") WHERE "decision_reviews"."idempotency_key" IS NOT NULL;