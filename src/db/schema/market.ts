import { pgTable, uuid, text, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { marketDataTypeEnum } from "./enums";

// Immutable from the moment it's captured (docs/data-model.md §7) — a
// frozen fact-at-a-time, referenced by DecisionSnapshot with ON DELETE
// RESTRICT (see decisions.ts).
export const marketContexts = pgTable("market_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  indexLevel: numeric("index_level"),
  indexChange1d: numeric("index_change_1d"),
  indexChange1m: numeric("index_change_1m"),
  sectorPerformanceJson: jsonb("sector_performance_json"),
  volatilityIndexValue: numeric("volatility_index_value"),
  source: text("source").notNull(),
  rawDataJson: jsonb("raw_data_json"),
});

// Infrastructure cache, NOT Investment Memory — mutable/replaceable,
// purely operational. Backs Investment Case's Market Intelligence.
export const marketDataCache = pgTable("market_data_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticker: text("ticker").notNull(),
  dataType: marketDataTypeEnum("data_type").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
