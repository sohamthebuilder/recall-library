import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  doublePrecision,
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

/**
 * A chapter of a PDF Source: an entry of its outline, or a page range when it has none.
 * The learner selects chapters to propose Topics from (the whole text is chunked anyway).
 * `selected_at` set and `topics_proposed_at` null = waiting for Topic proposal.
 */
export const sourceChapters = pgTable(
  "source_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    /** 1-based, inclusive. */
    startPage: integer("start_page").notNull(),
    endPage: integer("end_page").notNull(),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    topicsProposedAt: timestamp("topics_proposed_at", { withTimezone: true }),
    /** Why proposing Topics from this chapter failed; it can be selected again. */
    failureReason: text("failure_reason"),
  },
  (t) => [uniqueIndex("source_chapters_source_ordinal").on(t.sourceId, t.ordinal)],
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

/** A flat label grouping related Topics. No hierarchy: a Tag is just a name. */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("tags_name_lower").on(sql`lower(${t.name})`)],
);

/** Which Tags a Topic has. */
export const topicTags = pgTable(
  "topic_tags",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.tagId] }), index("topic_tags_tag").on(t.tagId)],
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

export const explainerStatus = pgEnum("explainer_status", ["generating", "ready", "failed"]);

/**
 * A Topic's one Explainer (ADR 0001). Created when the Topic gets its first approved Source;
 * its content lives in immutable explainer_versions, and `current_version_id` points at the
 * one the learner studies. Null until the first version is generated.
 */
export const explainers = pgTable("explainers", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id")
    .notNull()
    .unique()
    .references(() => topics.id, { onDelete: "cascade" }),
  status: explainerStatus("status").notNull().default("generating"),
  /** Why generation failed, safe to show the learner. Set only when status is `failed`. */
  failureReason: text("failure_reason"),
  // No ON DELETE action: checked at statement end, so deleting the Explainer cascades cleanly.
  currentVersionId: uuid("current_version_id").references((): AnyPgColumn => explainerVersions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** What made an Explainer version. Every change to an Explainer creates a version (ADR 0001). */
export const explainerVersionCause = pgEnum("explainer_version_cause", [
  "generated",
  "instruction",
  "text_edit",
  "suggested_edit",
  "restore",
  "form_switch",
]);

/**
 * One immutable version of an Explainer (a database trigger refuses UPDATEs). `content` is
 * ExplainerContent (src/core/explainer-content.ts), validated before insert. `cause_detail`
 * holds cause-specific data, e.g. the instruction text or the version restored from.
 */
export const explainerVersions = pgTable(
  "explainer_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    explainerId: uuid("explainer_id")
      .notNull()
      .references((): AnyPgColumn => explainers.id, { onDelete: "cascade" }),
    /** 1, 2, 3... per Explainer. */
    number: integer("number").notNull(),
    content: jsonb("content").notNull(),
    cause: explainerVersionCause("cause").notNull(),
    causeDetail: jsonb("cause_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("explainer_versions_explainer_number").on(t.explainerId, t.number)],
);

export const recallPromptKind = pgEnum("recall_prompt_kind", ["explain", "compare", "apply", "why"]);
/** Who wrote a Recall Prompt's current wording. Reconciliation (#17) only touches `generated` ones. */
export const recallPromptOrigin = pgEnum("recall_prompt_origin", ["generated", "learner_edited", "learner_written"]);
/** `suspended` = paused by the learner; `retired` = dropped by reconciliation (#17), history kept. */
export const recallPromptState = pgEnum("recall_prompt_state", ["active", "suspended", "retired"]);
/** FSRS card state (ts-fsrs `State`: New, Learning, Review, Relearning). */
export const fsrsCardState = pgEnum("fsrs_card_state", ["new", "learning", "review", "relearning"]);

/**
 * A Recall Prompt on a Topic. `expected_points` is a jsonb string[] (from the Explainer, or the
 * learner's). Deleting is soft (`deleted_at`), so its Reviews (#6) keep pointing at it.
 * The `fsrs_*`/`due` columns are the per-prompt FSRS memory state (#6 updates them on a Review).
 */
export const recallPrompts = pgTable(
  "recall_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    kind: recallPromptKind("kind").notNull(),
    question: text("question").notNull(),
    expectedPoints: jsonb("expected_points").$type<string[]>().notNull(),
    origin: recallPromptOrigin("origin").notNull(),
    state: recallPromptState("state").notNull().default("active"),
    /** The Explainer version a generated prompt was made from (or last reconciled against). */
    explainerVersionId: uuid("explainer_version_id").references(() => explainerVersions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // FSRS memory state. A new prompt is due at once, with no stability/difficulty yet.
    due: timestamp("due", { withTimezone: true }).notNull(),
    stability: doublePrecision("stability"),
    difficulty: doublePrecision("difficulty"),
    fsrsState: fsrsCardState("fsrs_state").notNull().default("new"),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    /** ts-fsrs `learning_steps`. */
    learningSteps: integer("learning_steps").notNull().default(0),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  },
  (t) => [index("recall_prompts_topic").on(t.topicId), index("recall_prompts_due").on(t.state, t.due)],
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
