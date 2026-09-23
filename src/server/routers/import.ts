import { z } from "zod";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { parseCsv, suggestColumnMapping, validateImportRows, CANONICAL_FIELDS } from "@/lib/import";
import {
  manualEntryBatchSchema,
  manualTransactionRowSchema,
  reconciliationResolutionSchema,
  buildManualTransactionValues,
} from "@/lib/import/manual-entry";
import { detectCollisionGroups, type CollisionGroup } from "@/lib/import/collision-resolution";
import {
  reconcileTransactions,
  ReconciliationError,
  type IncomingTransaction,
  type ReconciliationResult,
  type TransactionSource,
} from "@/lib/import/reconcile";
import { computePositions } from "@/lib/portfolio/positions";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import {
  insertPortfolioOpeningState,
  confirmTransactionsWithOrdering,
  getHistoryFreshness,
  OrderResolutionError,
  type NewTransactionWithOrder,
} from "@/db/repositories/portfolio";
import { insertCorporateAction, listCorporateActionsForInvestor } from "@/db/repositories/corporate-actions";
import { isUniqueViolation } from "@/db/errors";

// Shared by `validate` (CSV) and `checkManualEntryCollisions` (manual
// entry) — same-day collision preview against this investor's
// already-persisted transactions, read-only (Investment Episode
// Independence design's collision-detection requirement). The atomic
// confirm-time contract (confirmTransactionsWithOrdering) re-derives this
// fresh, under the lock, rather than trusting this preview — this exists
// purely so the UI can show the user what's colliding and let them
// declare an order before submitting.
async function previewCollisions(
  investorId: string,
  incomingRows: { clientRowKey: string; ticker: string | null; transactionDate: Date }[]
): Promise<CollisionGroup[]> {
  const tickers = [...new Set(incomingRows.map((r) => r.ticker).filter((t): t is string => t !== null))];
  if (tickers.length === 0) return [];

  const existingRows = await db
    .select({
      id: transactions.id,
      ticker: transactions.ticker,
      transactionDate: transactions.transactionDate,
      intraDayOrder: transactions.intraDayOrder,
      orderUnknownReason: transactions.orderUnknownReason,
    })
    .from(transactions)
    .where(and(eq(transactions.investorId, investorId), inArray(transactions.ticker, tickers)));

  return detectCollisionGroups(incomingRows, existingRows);
}

// Read-only reconciliation preview (History Refresh V1) — the SAME engine
// confirmTransactionsWithOrdering re-runs under its locks at confirm time
// (src/lib/import/reconcile.ts); this only lets the review step show what
// is already in the history and collect the investor's resolutions. Same
// existing-row scope as the confirm path: every persisted row sharing a
// (ticker, date) key with an incoming row, ticker-less rows included.
async function previewReconciliation(
  investorId: string,
  incoming: IncomingTransaction[],
  mode: TransactionSource
): Promise<ReconciliationResult> {
  const tickers = [...new Set(incoming.map((r) => r.ticker).filter((t): t is string => t !== null))];
  const tickerlessDates = [...new Set(incoming.filter((r) => r.ticker === null).map((r) => r.transactionDate.getTime()))].map(
    (t) => new Date(t)
  );
  const scope = [
    tickers.length > 0 ? inArray(transactions.ticker, tickers) : undefined,
    tickerlessDates.length > 0 ? and(isNull(transactions.ticker), inArray(transactions.transactionDate, tickerlessDates)) : undefined,
  ].filter((c) => c !== undefined);
  const existing =
    scope.length === 0
      ? []
      : await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.investorId, investorId), or(...scope)));
  return reconcileTransactions(
    incoming,
    existing.map((e) => ({
      id: e.id,
      ticker: e.ticker,
      transactionType: e.transactionType,
      quantity: e.quantity,
      price: e.price,
      amount: e.amount,
      transactionDate: e.transactionDate,
      source: e.source,
    })),
    { mode }
  );
}

function translateConfirmError(err: unknown): never {
  if (err instanceof OrderResolutionError || err instanceof ReconciliationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

const columnMappingSchema = z.object(
  Object.fromEntries(CANONICAL_FIELDS.map((f) => [f, z.string().optional()]))
) as z.ZodType<Partial<Record<(typeof CANONICAL_FIELDS)[number], string>>>;

const openingStateInputSchema = z.object({
  ticker: z.string().min(1),
  quantity: z.number().positive(),
  costBasisPerShare: z.number().nonnegative().nullable(),
  costBasisConfidence: z.enum(["known", "approximate", "unknown"]),
  asOfDate: z.coerce.date(),
});

export const importRouter = router({
  // Step 1: upload -> headers + a preview + our best-guess column mapping.
  preview: protectedProcedure
    .input(z.object({ csvContent: z.string().min(1) }))
    .query(({ input }) => {
      const { headers, rows } = parseCsv(input.csvContent);
      return {
        headers,
        rowCount: rows.length,
        previewRows: rows.slice(0, 5),
        suggestedMapping: suggestColumnMapping(headers),
      };
    }),

  // Step 2: given a confirmed mapping, validate every row, flag any
  // ticker whose SELLs exceed what the file alone can explain (the signal
  // that a PortfolioOpeningState is needed before we import), and detect
  // same-day (investor+ticker+date) collisions — both within the file
  // itself and against this investor's already-persisted transactions —
  // so the review step can offer the user a chance to declare a relative
  // order before confirming (Investment Episode Independence design).
  validate: protectedProcedure
    .input(z.object({ csvContent: z.string().min(1), mapping: columnMappingSchema }))
    .query(async ({ ctx, input }) => {
      const { rows } = parseCsv(input.csvContent);
      const result = validateImportRows(rows, input.mapping);

      // File-alone dry run, with the investor's recorded stock splits
      // (Import Blockers V1) so a legitimate post-split sale is not reported
      // as exceeding holdings.
      const splits = (await listCorporateActionsForInvestor(db, ctx.investorId)).map((a) => ({
        ticker: a.ticker,
        effectiveDate: a.effectiveDate,
        ratioNumerator: a.ratioNumerator,
        ratioDenominator: a.ratioDenominator,
      }));
      const dryRun = computePositions(
        result.validRows.map((r) => ({
          ticker: r.ticker,
          transactionType: r.transactionType,
          quantity: r.quantity,
          price: r.price,
          amount: r.amount,
          transactionDate: r.transactionDate,
        })),
        [],
        undefined,
        splits
      );

      const [collisionGroups, reconciliation] = await Promise.all([
        previewCollisions(
          ctx.investorId,
          result.validRows.map((r) => ({
            clientRowKey: String(r.rowIndex),
            ticker: r.ticker,
            transactionDate: r.transactionDate,
          }))
        ),
        previewReconciliation(
          ctx.investorId,
          result.validRows.map((r) => ({
            clientRowKey: String(r.rowIndex),
            ticker: r.ticker,
            transactionType: r.transactionType,
            quantity: r.quantity,
            price: r.price,
            amount: r.amount,
            transactionDate: r.transactionDate,
            source: "csv_import" as const,
          })),
          "csv_import"
        ),
      ]);

      return {
        validCount: result.validRows.length,
        invalidRows: result.invalidRows,
        detectedTickers: result.detectedTickers,
        tickersNeedingOpeningState: [...new Set(dryRun.warnings.map((w) => w.ticker))],
        collisionGroups,
        reconciliation,
      };
    }),

  // Read-only preview for Manual Entry: same-day collisions (mirroring
  // `validate`'s collisionGroups — same shared detectCollisionGroups, same
  // "against the batch itself AND against already-persisted rows" scope)
  // plus the reconciliation classification (History Refresh V1). Rows are
  // keyed by their position in the submitted array (the client has no
  // other stable id before insert) — the same key buildManualTransactionValues
  // stamps for confirm.
  checkManualEntry: protectedProcedure
    .input(z.object({ rows: z.array(manualTransactionRowSchema) }))
    .query(async ({ ctx, input }) => {
      const values = buildManualTransactionValues(ctx.investorId, input.rows);
      const [collisionGroups, reconciliation] = await Promise.all([
        previewCollisions(
          ctx.investorId,
          values.map((v) => ({ clientRowKey: v.clientRowKey!, ticker: v.ticker!, transactionDate: v.transactionDate as Date }))
        ),
        previewReconciliation(
          ctx.investorId,
          values.map((v) => ({
            clientRowKey: v.clientRowKey!,
            ticker: v.ticker!,
            transactionType: v.transactionType,
            quantity: v.quantity!,
            price: v.price!,
            amount: v.amount,
            transactionDate: v.transactionDate as Date,
            source: "manual_entry" as const,
          })),
          "manual_entry"
        ),
      ]);
      return { collisionGroups, reconciliation };
    }),

  // Import Blockers V1 — immutable stock splits (docs/data-model.md §6
  // "CorporateAction"). Narrow by design: one kind, explicit confirmation,
  // no automatic detection and no provider lookup. The date is stored
  // date-only (00:00Z) like every transaction so the frozen same-day
  // ordering rule (action → opening state → transactions) is exact.
  corporateActions: protectedProcedure.query(({ ctx }) => listCorporateActionsForInvestor(db, ctx.investorId)),

  recordStockSplit: protectedProcedure
    .input(
      z.object({
        ticker: z.string().trim().min(1).max(12),
        effectiveDate: z.coerce.date(),
        ratioNumerator: z.number().int().positive(),
        ratioDenominator: z.number().int().positive(),
        source: z.enum(["issuer_disclosure", "broker_statement", "user_declared"]),
        evidence: z.string().trim().min(1),
        // The investor's explicit confirmation is part of the contract, not a
        // client-side nicety.
        confirmed: z.literal(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.ratioNumerator === input.ratioDenominator) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A 1:1 ratio is not a split." });
      }
      const d = input.effectiveDate;
      const effectiveDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      try {
        return await insertCorporateAction(db, {
          investorId: ctx.investorId,
          ticker: input.ticker.toUpperCase(),
          kind: "stock_split",
          effectiveDate,
          ratioNumerator: input.ratioNumerator,
          ratioDenominator: input.ratioDenominator,
          source: input.source,
          evidence: input.evidence,
        });
      } catch (err) {
        if (isUniqueViolation(err, "corporate_actions_investor_ticker_effective_date_unique")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A split for this ticker on this date is already recorded.",
          });
        }
        throw err;
      }
    }),

  // History freshness (History Refresh V1) — how far the persisted history
  // reaches. Informational facts only (docs/architecture.md §2.1): never a
  // broker sync claim, never a statement that the portfolio is current
  // beyond the latest transaction date.
  history: protectedProcedure.query(async ({ ctx }) => {
    const freshness = await getHistoryFreshness(db, ctx.investorId);
    const latest = freshness.latestTransactionDate;
    const ageDays = latest === null ? null : Math.max(0, Math.floor((Date.now() - latest.getTime()) / 86_400_000));
    return { ...freshness, ageDays };
  }),

  // Step 3: write everything. Refuses to import while any row is still
  // invalid — partial/silent imports would violate "never assume the
  // imported history is the whole portfolio" from the other direction
  // (pretending a broken file was cleanly imported).
  confirmImport: protectedProcedure
    .input(
      z.object({
        csvContent: z.string().min(1),
        mapping: columnMappingSchema,
        filename: z.string().min(1),
        openingStates: z.array(openingStateInputSchema).default([]),
        // Same-day ordering: rowIndex (as a string key) -> user-declared
        // relative order, for rows the review step's collisionGroups
        // flagged and the user resolved. Keyed by rowIndex since that's
        // the one stable identifier validate()'s collisionGroups already
        // exposes per row (NormalizedTransactionRow.rowIndex).
        rowOrderDeclarations: z.record(z.string(), z.number().int()).default({}),
        // History Refresh V1: the investor's answers for rows the review
        // step's `reconciliation` flagged, keyed by the same String(rowIndex).
        // Re-verified under the lock — a stale or missing answer fails the
        // whole import, never a silent insert.
        reconciliationResolutions: z.array(reconciliationResolutionSchema).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { rows } = parseCsv(input.csvContent);
      const result = validateImportRows(rows, input.mapping);

      if (result.invalidRows.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${result.invalidRows.length} row(s) still fail validation — fix or exclude them before importing.`,
        });
      }

      const values: NewTransactionWithOrder[] = result.validRows.map((r) => ({
        investorId: ctx.investorId,
        ticker: r.ticker,
        transactionType: r.transactionType,
        quantity: r.quantity === null ? null : String(r.quantity),
        price: r.price === null ? null : String(r.price),
        amount: String(r.amount),
        transactionDate: r.transactionDate,
        source: "csv_import" as const,
        importBatchId: null, // stamped inside the confirm transaction (importBatch option below)
        notes: r.notes,
        clientDeclaredOrder: input.rowOrderDeclarations[String(r.rowIndex)],
        clientRowKey: String(r.rowIndex),
      }));

      // The ImportBatch row is created inside the same transaction as the
      // rows it contributes, with row_count = rows actually inserted after
      // reconciliation (0 for a file that was already fully imported) — an
      // import refused for an unresolved/stale reconciliation leaves no
      // batch behind.
      const confirmed = await confirmTransactionsWithOrdering(db, ctx.investorId, values, {
        mode: "csv_import",
        resolutions: input.reconciliationResolutions,
        importBatch: { filename: input.filename },
      }).catch(translateConfirmError);

      for (const os of input.openingStates) {
        await insertPortfolioOpeningState(db, {
          investorId: ctx.investorId,
          ticker: os.ticker,
          quantity: String(os.quantity),
          costBasisPerShare: os.costBasisPerShare === null ? null : String(os.costBasisPerShare),
          costBasisConfidence: os.costBasisConfidence,
          asOfDate: os.asOfDate,
        });
      }

      const positions = await computePositionsForInvestor(db, ctx.investorId);

      return {
        batchId: confirmed.batch!.id,
        importedCount: confirmed.inserted.length,
        skippedExactCount: confirmed.plan.skippedExact.length,
        skippedSameCount: confirmed.plan.skippedSame.length,
        separateCount: confirmed.plan.separate.length,
        positions,
      };
    }),

  // Manual Historical Entry (docs/backlog.md) — Actual trades only, one
  // batch at a time, no CSV file. Writes to the same `transactions`
  // table CSV import uses, with source="manual_entry" and no
  // importBatchId (there's no ImportBatch row for a manual entry — the
  // "batch" is only the client's in-memory form state for this one
  // submit, matching the nullable importBatchId contract CSV import
  // already relies on). `amount` is never accepted from the client —
  // buildManualTransactionValues computes it server-side via the same
  // canonical rule CSV import uses (validate.ts's
  // computeAmountFromQuantityPrice), not a second implementation of it.
  //
  // The whole batch is one all-or-nothing DB write: confirmTransactionsWithOrdering
  // wraps everything (locks, reconciliation, ordering resolution, the
  // insert itself) in one db.transaction, so a mid-batch failure —
  // including an OrderResolutionError or a ReconciliationError — leaves
  // zero rows, not a partial batch. Same atomic contract as CSV import's
  // confirmImport, through the exact same shared function; manual mode
  // is stricter about identical rows (History Refresh V1: an identical
  // row blocks until the investor says it is intentionally a separate
  // trade — never silently a second copy).
  confirmManualEntry: protectedProcedure
    .input(manualEntryBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const values = buildManualTransactionValues(ctx.investorId, input.rows);

      const confirmed = await confirmTransactionsWithOrdering(db, ctx.investorId, values, {
        mode: "manual_entry",
        resolutions: input.resolutions,
      }).catch(translateConfirmError);

      const positions = await computePositionsForInvestor(db, ctx.investorId);

      return {
        transactions: confirmed.inserted,
        skippedCount: confirmed.plan.skippedExact.length + confirmed.plan.skippedSame.length,
        positions,
      };
    }),
});
