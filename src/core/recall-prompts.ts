import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { explainers, explainerVersions, recallPrompts, topics } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { parseStoredContent } from "./explainer-content";
import { enqueueJob } from "./jobs";
import type { RecallPromptDraft, RecallPromptKind } from "./ports/ai";
import { RECALL_PROMPT_KINDS } from "./recall-prompt-kinds";

/**
 * Recall Prompts: questions about a Topic, generated from its current Explainer or written by
 * the learner. Each carries its per-prompt FSRS memory state (see recall_prompts in schema.ts),
 * which Reviews (#6) update. Deleting is soft, so Review history survives.
 */

export type { RecallPromptKind } from "./ports/ai";
export type RecallPromptOrigin = "generated" | "learner_edited" | "learner_written";
export type RecallPromptState = "active" | "suspended" | "retired";


export interface RecallPrompt {
  id: string;
  topicId: string;
  kind: RecallPromptKind;
  question: string;
  expectedPoints: string[];
  origin: RecallPromptOrigin;
  state: RecallPromptState;
  createdAt: Date;
  updatedAt: Date;
  /** When FSRS next wants it reviewed. A new prompt is due when it is created. */
  due: Date;
}

export const UNUSABLE_RECALL_PROMPTS = "The AI produced Recall Prompts that could not be used.";

// ---------------------------------------------------------------------------------------
// Reacting to a new current Explainer version (called from saveExplainerVersion)

/** The Explainer's current version changed: queue the Topic's Recall Prompts update. */
export async function onExplainerVersionSaved(tx: DbOrTx, now: Date, topicId: string): Promise<void> {
  await enqueueJob(tx, now, "update_recall_prompts", { topicId });
}

/**
 * The update_recall_prompts job. A Topic that never had generated prompts gets them generated
 * from its current Explainer. Otherwise the generated prompts are reconciled with it (#17).
 */
export async function updateRecallPrompts(deps: CoreDeps, { topicId }: { topicId: string }): Promise<void> {
  const [row] = await deps.db
    .select({ topic: topics, versionId: explainerVersions.id, content: explainerVersions.content })
    .from(topics)
    .innerJoin(explainers, eq(explainers.topicId, topics.id))
    .innerJoin(explainerVersions, eq(explainerVersions.id, explainers.currentVersionId))
    .where(eq(topics.id, topicId));
  if (!row) return;

  if ((await generatedCount(deps.db, topicId)) > 0) {
    // #17: reconcile the Topic's generated prompts with the new version here.
    return;
  }

  const drafts = await deps.ai.generateRecallPrompts({
    topic: { name: row.topic.name, description: row.topic.description },
    explainer: parseStoredContent(row.content),
  });
  const usable = usableDrafts(drafts);
  if (!usable) throw new Error(UNUSABLE_RECALL_PROMPTS);

  const now = deps.clock.now();
  await deps.db.insert(recallPrompts).values(
    usable.map((d) => ({
      topicId,
      kind: d.kind,
      question: d.question,
      expectedPoints: d.expectedPoints,
      origin: "generated" as const,
      explainerVersionId: row.versionId,
      createdAt: now,
      updatedAt: now,
      due: now,
    })),
  );
}

const draftSchema = z.object({
  kind: z.enum(["explain", "compare", "apply", "why"]),
  question: z.string().trim().min(1),
  expectedPoints: z.array(z.string().trim()).transform((ps) => ps.filter((p) => p.length > 0)).pipe(z.array(z.string()).min(1)),
});

/** The well-formed drafts, or null unless they cover all four kinds. */
function usableDrafts(drafts: unknown): RecallPromptDraft[] | null {
  if (!Array.isArray(drafts)) return null;
  const usable: RecallPromptDraft[] = [];
  for (const d of drafts) {
    const parsed = draftSchema.safeParse(d);
    if (parsed.success) usable.push(parsed.data);
  }
  return RECALL_PROMPT_KINDS.every((k) => usable.some((d) => d.kind === k)) ? usable : null;
}

// ---------------------------------------------------------------------------------------
// Reading

/** A Topic's Recall Prompts (not deleted), by kind, then oldest first. */
export async function listRecallPrompts(deps: CoreDeps, topicId: string): Promise<RecallPrompt[]> {
  await assertTopicExists(deps.db, topicId);
  const rows = await deps.db
    .select()
    .from(recallPrompts)
    .where(and(eq(recallPrompts.topicId, topicId), isNull(recallPrompts.deletedAt)))
    .orderBy(
      sql`array_position(array['explain','compare','apply','why']::recall_prompt_kind[], ${recallPrompts.kind})`,
      asc(recallPrompts.createdAt),
      asc(recallPrompts.id),
    );
  return rows.map(toRecallPrompt);
}

export function toRecallPrompt(row: typeof recallPrompts.$inferSelect): RecallPrompt {
  return {
    id: row.id,
    topicId: row.topicId,
    kind: row.kind,
    question: row.question,
    expectedPoints: row.expectedPoints,
    origin: row.origin,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    due: row.due,
  };
}

// ---------------------------------------------------------------------------------------
// Learner operations

/**
 * Queue generation of a Topic's Recall Prompts again, after it failed. Only for a Topic
 * with an Explainer and no generated prompts yet (deleted ones count: they were dropped on purpose).
 */
export async function generateRecallPrompts(deps: CoreDeps, topicId: string): Promise<void> {
  const [row] = await deps.db
    .select({ currentVersionId: explainers.currentVersionId })
    .from(topics)
    .leftJoin(explainers, eq(explainers.topicId, topics.id))
    .where(eq(topics.id, topicId));
  if (!row) throw new NotFoundError("That Topic no longer exists.");
  if (!row.currentVersionId) throw new ValidationError("This Topic has no Explainer to make Recall Prompts from yet.");
  if ((await generatedCount(deps.db, topicId)) > 0) throw new ValidationError("This Topic already has its Recall Prompts.");
  await enqueueJob(deps.db, deps.clock.now(), "update_recall_prompts", { topicId });
}

export interface RecallPromptWording {
  kind: RecallPromptKind;
  question: string;
  expectedPoints: string[];
}

export type EditRecallPromptInput = RecallPromptWording & { promptId: string };
export type AddRecallPromptInput = RecallPromptWording & { topicId: string };

/** Change a prompt's wording. A generated prompt becomes `learner_edited`; its schedule is kept. */
export async function editRecallPrompt(deps: CoreDeps, input: EditRecallPromptInput): Promise<RecallPrompt> {
  const wording = checkWording(input);
  const existing = await livePrompt(deps.db, input.promptId);
  const [row] = await deps.db
    .update(recallPrompts)
    .set({
      ...wording,
      origin: existing.origin === "learner_written" ? "learner_written" : "learner_edited",
      updatedAt: deps.clock.now(),
    })
    .where(eq(recallPrompts.id, existing.id))
    .returning();
  return toRecallPrompt(row!);
}

/** Write a new prompt for a Topic (`learner_written`), active and due at once. */
export async function addRecallPrompt(deps: CoreDeps, input: AddRecallPromptInput): Promise<RecallPrompt> {
  const wording = checkWording(input);
  await assertTopicExists(deps.db, input.topicId);
  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(recallPrompts)
    .values({ topicId: input.topicId, ...wording, origin: "learner_written", createdAt: now, updatedAt: now, due: now })
    .returning();
  return toRecallPrompt(row!);
}

/** Pause an active prompt: it is not reviewed until resumed. Its schedule is kept. */
export async function suspendRecallPrompt(deps: CoreDeps, promptId: string): Promise<RecallPrompt> {
  return changeState(deps, promptId, "active", "suspended", "Only an active Recall Prompt can be paused.");
}

/** Resume a paused prompt. */
export async function resumeRecallPrompt(deps: CoreDeps, promptId: string): Promise<RecallPrompt> {
  return changeState(deps, promptId, "suspended", "active", "Only a paused Recall Prompt can be resumed.");
}

/** Soft delete: the prompt disappears from the Topic, its Review history stays. */
export async function deleteRecallPrompt(deps: CoreDeps, promptId: string): Promise<void> {
  const existing = await livePrompt(deps.db, promptId);
  await deps.db.update(recallPrompts).set({ deletedAt: deps.clock.now() }).where(eq(recallPrompts.id, existing.id));
}

async function changeState(
  deps: CoreDeps,
  promptId: string,
  from: RecallPromptState,
  to: RecallPromptState,
  refusal: string,
): Promise<RecallPrompt> {
  const existing = await livePrompt(deps.db, promptId);
  if (existing.state !== from) throw new ValidationError(refusal);
  const [row] = await deps.db
    .update(recallPrompts)
    .set({ state: to, updatedAt: deps.clock.now() })
    .where(eq(recallPrompts.id, existing.id))
    .returning();
  return toRecallPrompt(row!);
}

const wordingSchema = z.object({
  kind: z.enum(["explain", "compare", "apply", "why"], { error: "Choose a kind: Explain, Compare, Apply or Why." }),
  question: z.string().trim().min(1, { error: "Write the question." }),
  expectedPoints: z
    .array(z.string().trim())
    .transform((ps) => ps.filter((p) => p.length > 0))
    .pipe(z.array(z.string()).min(1, { error: "Add at least one expected key point." })),
});

function checkWording(input: RecallPromptWording): RecallPromptWording {
  const parsed = wordingSchema.safeParse({ kind: input.kind, question: input.question, expectedPoints: input.expectedPoints });
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  return parsed.data;
}

/** A prompt that exists and is not deleted, or NotFoundError. */
async function livePrompt(db: DbOrTx, promptId: string) {
  const [row] = await db
    .select()
    .from(recallPrompts)
    .where(and(sql`${recallPrompts.id}::text = ${promptId}`, isNull(recallPrompts.deletedAt)));
  if (!row) throw new NotFoundError("That Recall Prompt no longer exists.");
  return row;
}

async function assertTopicExists(db: DbOrTx, topicId: string) {
  const [topic] = await db.select({ id: topics.id }).from(topics).where(sql`${topics.id}::text = ${topicId}`);
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
}

/** How many prompts were ever generated for the Topic (edited and deleted ones included). */
async function generatedCount(db: DbOrTx, topicId: string): Promise<number> {
  const [{ generated } = { generated: 0 }] = await db
    .select({ generated: sql<number>`count(*)::int` })
    .from(recallPrompts)
    .where(and(eq(recallPrompts.topicId, topicId), inArray(recallPrompts.origin, ["generated", "learner_edited"])));
  return generated;
}
