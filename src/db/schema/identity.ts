import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Single-user in practice (docs/architecture.md), but modeled as a real
// table + investor_id FK on aggregate roots so we're not blocked later —
// no multi-tenant logic anywhere, just an owner reference.
export const investors = pgTable("investors", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
