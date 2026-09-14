CREATE TYPE "public"."order_unknown_reason" AS ENUM('user_declared', 'never_recorded');--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "intra_day_order" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "order_unknown_reason" "order_unknown_reason";--> statement-breakpoint
-- Targeted backfill (Investment Episode Independence design §5/§14):
-- mark every existing row that shares (investor_id, ticker,
-- transaction_date) with at least one other existing row as
-- order_unknown_reason='never_recorded' — ambiguity discovered after the
-- fact, no human was ever asked. intra_day_order is left NULL for these
-- rows (state 3, "unresolved/unknown" — see transactions.intraDayOrder's
-- comment): nothing here invents an order that was never recorded.
-- Scoped to ticker IS NOT NULL: pure cash movements (deposit/withdrawal/
-- fee with no ticker) have no position/episode concept and are never
-- touched, even if several share an investor+date. Runs before the
-- partial unique index below on purpose (agreed internal order:
-- enum/columns -> targeted backfill -> partial unique index) — this
-- UPDATE only ever sets order_unknown_reason and never touches
-- intra_day_order, so it cannot itself violate that index.
UPDATE "transactions" AS t
SET "order_unknown_reason" = 'never_recorded'
WHERE t."ticker" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "transactions" AS t2
    WHERE t2."investor_id" = t."investor_id"
      AND t2."ticker" = t."ticker"
      AND t2."transaction_date" = t."transaction_date"
      AND t2."id" <> t."id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_investor_ticker_date_intraday_order_unique" ON "transactions" USING btree ("investor_id","ticker","transaction_date","intra_day_order") WHERE "transactions"."intra_day_order" IS NOT NULL;