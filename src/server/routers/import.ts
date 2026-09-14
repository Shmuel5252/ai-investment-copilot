import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { parseCsv, suggestColumnMapping, validateImportRows, CANONICAL_FIELDS } from "@/lib/import";
import {
  manualEntryBatchSchema,
  manualTransactionRowSchema,
  buildManualTransactionValues,
} from "@/lib/import/manual-entry";
import { detectCollisionGroups, type CollisionGroup } from "@/lib/import/collision-resolution";
import { computePositions } from "@/lib/portfolio/positions";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import {
  insertImportBatch,
  insertPortfolioOpeningState,
  confirmTransactionsWithOrdering,
  OrderResolutionError,
  type NewTransactionWithOrder,
} from "@/db/repositories/portfolio";

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

      const dryRun = computePositions(
        result.validRows.map((r) => ({
          ticker: r.ticker,
          transactionType: r.transactionType,
          quantity: r.quantity,
          price: r.price,
          amount: r.amount,
          transactionDate: r.transactionDate,
        })),
        []
      );

      const collisionGroups = await previewCollisions(
        ctx.investorId,
        result.validRows.map((r) => ({
          clientRowKey: String(r.rowIndex),
          ticker: r.ticker,
          transactionDate: r.transactionDate,
        }))
      );

      return {
        validCount: result.validRows.length,
        invalidRows: result.invalidRows,
        detectedTickers: result.detectedTickers,
        tickersNeedingOpeningState: [...new Set(dryRun.warnings.map((w) => w.ticker))],
        collisionGroups,
      };
    }),

  // Read-only collision preview for Manual Entry, mirroring `validate`'s
  // collisionGroups for CSV — same shared detectCollisionGroups, same
  // "against the file/batch itself AND against already-persisted rows"
  // scope. Rows are keyed by their position in the submitted array (the
  // client has no other stable id before insert).
  checkManualEntryCollisions: protectedProcedure
    .input(z.object({ rows: z.array(manualTransactionRowSchema) }))
    .query(({ ctx, input }) =>
      previewCollisions(
        ctx.investorId,
        input.rows.map((r, i) => ({
          clientRowKey: String(i),
          ticker: r.ticker.trim().toUpperCase(),
          transactionDate: r.transactionDate,
        }))
      )
    ),

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

      const batch = await insertImportBatch(db, {
        investorId: ctx.investorId,
        filename: input.filename,
        rowCount: result.validRows.length,
        status: "completed",
      });

      const values: NewTransactionWithOrder[] = result.validRows.map((r) => ({
        investorId: ctx.investorId,
        ticker: r.ticker,
        transactionType: r.transactionType,
        quantity: r.quantity === null ? null : String(r.quantity),
        price: r.price === null ? null : String(r.price),
        amount: String(r.amount),
        transactionDate: r.transactionDate,
        source: "csv_import" as const,
        importBatchId: batch.id,
        notes: r.notes,
        clientDeclaredOrder: input.rowOrderDeclarations[String(r.rowIndex)],
      }));

      try {
        await confirmTransactionsWithOrdering(db, ctx.investorId, values);
      } catch (err) {
        if (err instanceof OrderResolutionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

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

      return { batchId: batch.id, importedCount: result.validRows.length, positions };
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
  // wraps everything (locks, ordering resolution, the insert itself) in
  // one db.transaction, so a mid-batch failure — including an
  // OrderResolutionError — leaves zero rows, not a partial batch. Same
  // atomic same-day-ordering contract as CSV import's confirmImport,
  // through the exact same shared function.
  confirmManualEntry: protectedProcedure
    .input(manualEntryBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const values = buildManualTransactionValues(ctx.investorId, input.rows);

      let inserted;
      try {
        inserted = await confirmTransactionsWithOrdering(db, ctx.investorId, values);
      } catch (err) {
        if (err instanceof OrderResolutionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

      const positions = await computePositionsForInvestor(db, ctx.investorId);

      return { transactions: inserted, positions };
    }),
});
