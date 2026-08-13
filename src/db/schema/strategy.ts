import { pgTable, uuid, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { investors } from "./identity";
import { principleTypeEnum, principleCreatedByEnum } from "./enums";

export const strategyPrinciples = pgTable("strategy_principles", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  key: text("key").notNull(), // stable slug, e.g. "position-sizing-cap"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const strategyPrincipleVersions = pgTable("strategy_principle_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyPrincipleId: uuid("strategy_principle_id")
    .notNull()
    .references(() => strategyPrinciples.id),
  versionNumber: integer("version_number").notNull(),
  principleType: principleTypeEnum("principle_type").notNull(),
  statementText: text("statement_text").notNull(),
  rationaleText: text("rationale_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: principleCreatedByEnum("created_by").notNull(),
  changeReason: text("change_reason"),
});

// Whole-bundle version (docs/data-model.md §0): "Strategy" as a concept =
// the latest row here. No separate `approved_by` column — this table is
// only ever written through the user-approval flow (application-layer
// invariant, per Product Principle "Strategy never changes silently");
// investor_id already records whose strategy it is.
export const strategyVersions = pgTable("strategy_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),
  versionNumber: integer("version_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  changeSummary: text("change_summary").notNull(),
});

// Which principle-versions are bundled into a given whole-strategy
// version (including carried-over, unchanged ones).
export const strategyVersionPrinciples = pgTable(
  "strategy_version_principles",
  {
    strategyVersionId: uuid("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id),
    strategyPrincipleVersionId: uuid("strategy_principle_version_id")
      .notNull()
      .references(() => strategyPrincipleVersions.id),
  },
  (table) => [primaryKey({ columns: [table.strategyVersionId, table.strategyPrincipleVersionId] })]
);
