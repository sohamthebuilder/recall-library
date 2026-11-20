import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const sourceKind = pgEnum("source_kind", ["url", "youtube", "pdf", "markdown", "note"]);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: sourceKind("kind").notNull(),
  title: text("title"),
  /** Original reference: the URL or file name. Null for a Note. */
  reference: text("reference"),
  /** Full text captured when the Source was added. */
  text: text("text").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
});
