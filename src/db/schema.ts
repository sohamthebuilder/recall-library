import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Every embedding (Source chunks, Topics) has this many dimensions: OpenAI
 * text-embedding-3-small. The fake AI pads its vectors to the same size.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const sourceKind = pgEnum("source_kind", ["url", "youtube", "pdf", "markdown", "note"]);

export const sourceStatus = pgEnum("source_status", [
  "pending",
  "fetching",
  "extracting",
  "proposing_topics",
  "ready",
  "failed",
]);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: sourceKind("kind").notNull(),
  title: text("title"),
  /** Original reference: the URL or file name. Null for a Note. */
  reference: text("reference"),
  /** Key of the uploaded file in the file store (uploaded .md/.pdf). Null for other kinds. */
  fileKey: text("file_key"),
  /** Full text captured when the Source was processed. Null until captured (a Note has it at once). */
  text: text("text"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  /** When `text` was captured (fetched and extracted). Null until then. */
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  status: sourceStatus("status").notNull().default("pending"),
  /** Why processing failed, safe to show the learner. Set only when status is `failed`. */
  failureReason: text("failure_reason"),
});

/**
 * A piece of a Source's captured text. Citations point at chunks, and Ask (v2) searches them.
 * `anchor` locates the chunk: character offsets into the Source's text, plus a page or
 * timestamp when the Source kind has one (see ChunkAnchor in src/core/chunking.ts).
 */
export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    anchor: jsonb("anchor").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (t) => [uniqueIndex("source_chunks_source_ordinal").on(t.sourceId, t.ordinal)],
);

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    /** Embedding of the Topic's name and description, used to match proposed Topics. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("topics_name_lower").on(sql`lower(${t.name})`)],
);

/** Approved Topic–Source links. Only these count; proposals live in topic_proposals. */
export const topicSources = pgTable(
  "topic_sources",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.sourceId] }), index("topic_sources_source").on(t.sourceId)],
);

export const topicProposalStatus = pgEnum("topic_proposal_status", ["pending", "approved", "rejected"]);

/** A Topic the AI proposed for a Source, waiting for the learner's decision. */
export const topicProposals = pgTable(
  "topic_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** The existing Topic this proposal was matched to, or null if it is new. */
    matchedTopicId: uuid("matched_topic_id").references(() => topics.id, { onDelete: "set null" }),
    status: topicProposalStatus("status").notNull().default("pending"),
    /** The Topic the learner linked the Source to when approving or merging. */
    resolvedTopicId: uuid("resolved_topic_id").references(() => topics.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("topic_proposals_source").on(t.sourceId)],
);

export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);

/** Durable background job queue, drained by runJobs (see src/core/jobs.ts). */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_status_created").on(t.status, t.createdAt)],
);
