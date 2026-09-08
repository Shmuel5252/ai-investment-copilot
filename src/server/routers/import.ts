import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { parseCsv, suggestColumnMapping, validateImportRows, CANONICAL_FIELDS } from "@/lib/import";
import { manualEntryBatchSchema, buildManualTransactionValues } from "@/lib/import/manual-entry";
import { computePositions } from "@/lib/portfolio/positions";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import {
  insertImportBatch,
  insertTransactions,
  insertPortfolioOpeningState,
} from "@/db/repositories/portfolio";

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

  // Step 2: given a confirmed mapping, validate every row and flag any
  // ticker whose SELLs exceed what the file alone can explain — the
  // signal that a PortfolioOpeningState is needed before we import.
  validate: protectedProcedure
    .input(z.object({ csvContent: z.string().min(1), mapping: columnMappingSchema }))
    .query(({ input }) => {
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

      return {
        validCount: result.validRows.length,
        invalidRows: result.invalidRows,
        detectedTickers: result.detectedTickers,
        tickersNeedingOpeningState: [...new Set(dryRun.warnings.map((w) => w.ticker))],
      };
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

      await insertTransactions(
        db,
        result.validRows.map((r) => ({
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
        }))
      );

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
  // The whole batch is one all-or-nothing DB write: wrapped in
  // db.transaction so a mid-batch failure leaves zero rows, not a
  // partial batch — the one DB write unit here, nothing external before
  // it needs covering (no FMP/Anthropic calls, unlike decisions.create).
  confirmManualEntry: protectedProcedure
    .input(manualEntryBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const values = buildManualTransactionValues(ctx.investorId, input.rows);

      const inserted = await db.transaction(async (tx) => insertTransactions(tx, values));

      const positions = await computePositionsForInvestor(db, ctx.investorId);

      return { transactions: inserted, positions };
    }),
});
