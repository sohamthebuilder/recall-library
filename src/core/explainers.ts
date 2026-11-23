import { and, asc, cosineDistance, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { explainers, explainerVersions, sourceChunks, sources, topicSources, topics } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { ChunkAnchor } from "./chunking";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import {
  type ExplainerCitation,
  type ExplainerContent,
  type ExplainerForm,
  parseStoredContent,
  validateExplainerContent,
  validateExplainerDraft,
} from "./explainer-content";
import { enqueueJob } from "./jobs";
import { AiError, type ExplainerPassage } from "./ports/ai";
import { onExplainerVersionSaved } from "./recall-prompts";
import { sourceRow } from "./sources";

/**
 * Explainers (ADR 0001). A Topic gets exactly one Explainer, once it has an approved Source.
 * Its content is a chain of immutable versions; the Explainer's current pointer says which
 * one the learner studies. Every change goes through `saveExplainerVersion`.
 */

/** Generation sees at most this many passages from each Source... */
const PASSAGES_PER_SOURCE = 6;
/** ...and at most this many in all. */
const MAX_PASSAGES = 18;

export const UNUSABLE_EXPLAINER_REASON = "The AI produced an Explainer that could not be used. Try again.";
export const NO_SOURCE_TEXT_REASON = "None of this Topic's Sources has any text yet. Retry a Source, or link another.";
export const UNUSABLE_STEPS_REASON = "The AI could not turn this Explainer into an animation. Try again.";
export const UNEXPECTED_EXPLAINER_FAILURE = "Something went wrong while making this Explainer. Try again.";

export type ExplainerStatus = "generating" | "ready" | "failed";
export type ExplainerVersionCause =
  | "generated"
  | "instruction"
  | "text_edit"
  | "suggested_edit"
  | "restore"
  | "form_switch";

export interface ExplainerVersionSummary {
  id: string;
  /** 1 for the first version, then 2, 3... */
  number: number;
  cause: ExplainerVersionCause;
  createdAt: Date;
}

export interface ExplainerVersion extends ExplainerVersionSummary {
  content: ExplainerContent;
}

/** What a citation shows when tapped: the cited passage, or that its Source was deleted. */
export type CitedPassage =
  | {
      status: "available";
      chunkId: string;
      sourceId: string;
      sourceTitle: string | null;
      text: string;
      anchor: ChunkAnchor;
    }
  | { status: "source_removed"; chunkId: string; sourceId: string };

export interface Explainer {
  topicId: string;
  /** `generating` until the first version exists; `failed` (with a reason) if that did not work. */
  status: ExplainerStatus;
  failureReason: string | null;
  /** The version the learner studies. Null until the first one is generated. */
  current: ExplainerVersion | null;
  /** Every passage the current version cites, by chunk id. */
  passages: Record<string, CitedPassage>;
}

// ---------------------------------------------------------------------------------------
// Reacting to a new Topic–Source link (called from linkSourceToTopic)

/**
 * A Source was just linked to a Topic. If the Topic has no Explainer yet, create one and
 * queue its generation. If one is still being generated, that job will include this Source.
 * If one exists already, it is never regenerated (ADR 0001): Suggested Edits (#20) hook in here.
 */
export async function onSourceLinked(
  tx: DbOrTx,
  now: Date,
  link: { topicId: string; sourceId: string },
): Promise<void> {
  const created = await tx
    .insert(explainers)
    .values({ topicId: link.topicId, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: explainers.id });
  if (created.length > 0) {
    await enqueueJob(tx, now, "generate_explainer", { topicId: link.topicId });
    return;
  }
  const [existing] = await tx.select().from(explainers).where(eq(explainers.topicId, link.topicId));
  if (existing && existing.status === "failed" && !existing.currentVersionId) {
    await startGenerating(tx, now, existing.id, link.topicId);
  }
}

/**
 * A Source's text and chunks were just (re)captured. Any Topic it is linked to whose first
 * Explainer is still waiting (or failed) for want of text is queued for generation again.
 */
export async function onSourceTextCaptured(tx: DbOrTx, now: Date, sourceId: string): Promise<void> {
  const waiting = await tx
    .select({ id: explainers.id, topicId: explainers.topicId })
    .from(explainers)
    .innerJoin(topicSources, eq(topicSources.topicId, explainers.topicId))
    .where(and(eq(topicSources.sourceId, sourceId), isNull(explainers.currentVersionId)));
  for (const e of waiting) await startGenerating(tx, now, e.id, e.topicId);
}

async function startGenerating(tx: DbOrTx, now: Date, explainerId: string, topicId: string) {
  await tx.update(explainers).set({ status: "generating", failureReason: null }).where(eq(explainers.id, explainerId));
  await enqueueJob(tx, now, "generate_explainer", { topicId });
}

// ---------------------------------------------------------------------------------------
// Generation (the generate_explainer job)

/**
 * Generate a Topic's first Explainer from all its Sources. Does nothing if the Explainer
 * already has a version: an existing Explainer is never regenerated.
 */
export async function generateExplainer(deps: CoreDeps, { topicId }: { topicId: string }): Promise<void> {
  const [explainer] = await deps.db.select().from(explainers).where(eq(explainers.topicId, topicId));
  if (!explainer || explainer.currentVersionId || explainer.status !== "generating") return;

  try {
    const [topic] = await deps.db.select().from(topics).where(eq(topics.id, topicId));
    if (!topic) return;
    const passages = await passagesFor(deps, topic.id, topic.embedding);
    if (passages.length === 0) {
      const linked = await deps.db
        .select({ status: sources.status })
        .from(topicSources)
        .innerJoin(sources, eq(sources.id, topicSources.sourceId))
        .where(eq(topicSources.topicId, topicId));
      if (linked.length === 0) {
        // ADR 0001: a Topic with no Source gets no Explainer.
        await deps.db.delete(explainers).where(eq(explainers.id, explainer.id));
      } else if (linked.every((s) => s.status === "failed")) {
        await markFailed(deps, explainer.id, NO_SOURCE_TEXT_REASON);
      }
      // Otherwise a linked Source is still being processed; onSourceTextCaptured queues this job again.
      return;
    }

    const draft = await deps.ai.generateExplainer({
      topic: { name: topic.name, description: topic.description },
      passages: passages.map(({ chunkId, sourceTitle, text }) => ({ chunkId, sourceTitle, text })),
    });
    const content = citedContent(draft, passages);
    if (!content) return await markFailed(deps, explainer.id, UNUSABLE_EXPLAINER_REASON);

    await deps.db.transaction(async (tx) => {
      await saveExplainerVersion(tx, deps.clock.now(), { explainerId: explainer.id, content, cause: "generated" });
    });
  } catch (e) {
    await markFailed(deps, explainer.id, e instanceof AiError ? e.message : UNEXPECTED_EXPLAINER_FAILURE);
    if (!(e instanceof AiError)) throw e;
  }
}

/** The most relevant chunks of each of the Topic's Sources, interleaved so every Source is represented. */
async function passagesFor(
  deps: CoreDeps,
  topicId: string,
  topicEmbedding: number[],
): Promise<(ExplainerPassage & { sourceId: string })[]> {
  const linked = await deps.db
    .select({ id: sources.id, title: sources.title })
    .from(topicSources)
    .innerJoin(sources, eq(sources.id, topicSources.sourceId))
    .where(eq(topicSources.topicId, topicId))
    .orderBy(asc(topicSources.linkedAt));

  const perSource = await Promise.all(
    linked.map(async (source) => {
      const rows = await deps.db
        .select({ chunkId: sourceChunks.id, text: sourceChunks.text })
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceId, source.id))
        .orderBy(cosineDistance(sourceChunks.embedding, topicEmbedding), asc(sourceChunks.ordinal))
        .limit(PASSAGES_PER_SOURCE);
      return rows.map((r) => ({ ...r, sourceId: source.id, sourceTitle: source.title }));
    }),
  );

  const out: (ExplainerPassage & { sourceId: string })[] = [];
  for (let i = 0; out.length < MAX_PASSAGES && perSource.some((list) => i < list.length); i++) {
    for (const list of perSource) {
      if (i < list.length && out.length < MAX_PASSAGES) out.push(list[i]!);
    }
  }
  return out;
}

/**
 * Validate an AI draft and attach each citation's Source. Null if the draft is malformed,
 * cites a passage it was not given, or has a key point without a citation.
 */
function citedContent(draft: unknown, passages: { chunkId: string; sourceId: string }[]): ExplainerContent | null {
  const checked = validateExplainerDraft(draft);
  if (!checked.ok) {
    console.warn("Unusable Explainer draft:", checked.problems.join("; "));
    return null;
  }
  const sourceOf = new Map(passages.map((p) => [p.chunkId, p.sourceId]));
  const keyPoints = [];
  for (const point of checked.value.keyPoints) {
    const citations: ExplainerCitation[] = [];
    for (const { chunkId } of point.citations) {
      const sourceId = sourceOf.get(chunkId);
      if (!sourceId) {
        console.warn(`Unusable Explainer draft: key point ${point.id} cites an unknown passage`);
        return null;
      }
      if (!citations.some((c) => c.chunkId === chunkId)) citations.push({ chunkId, sourceId });
    }
    if (citations.length === 0) {
      console.warn(`Unusable Explainer draft: key point ${point.id} cites nothing`);
      return null;
    }
    keyPoints.push({ ...point, citations });
  }
  return { ...checked.value, keyPoints };
}

async function markFailed(deps: CoreDeps, explainerId: string, reason: string): Promise<void> {
  await deps.db.update(explainers).set({ status: "failed", failureReason: reason }).where(eq(explainers.id, explainerId));
}

/** Try generating a Topic's first Explainer again after it failed. */
export async function retryExplainer(deps: CoreDeps, topicId: string): Promise<void> {
  const explainer = await explainerRow(deps.db, topicId);
  if (!explainer) throw new NotFoundError("That Topic has no Explainer.");
  if (explainer.status !== "failed") throw new ValidationError("Only an Explainer that failed can be retried.");
  await deps.db.transaction((tx) => startGenerating(tx, deps.clock.now(), explainer.id, topicId));
}

// ---------------------------------------------------------------------------------------
// Versions

export interface SaveExplainerVersionInput {
  explainerId: string;
  content: unknown;
  cause: ExplainerVersionCause;
  /** Cause-specific data kept with the version, e.g. `{ instruction }` or `{ restoredFrom }`. */
  causeDetail?: Record<string, unknown> | null;
}

/**
 * The one way an Explainer changes: validate the content, save it as the next immutable
 * version, and move the current pointer to it. Throws ValidationError (with the problems)
 * if the content is not a valid Explainer; nothing is saved then.
 *
 * Every new current version queues the Topic's Recall Prompts update (generation the first
 * time, reconciliation after: #17).
 */
export async function saveExplainerVersion(
  tx: DbOrTx,
  now: Date,
  input: SaveExplainerVersionInput,
): Promise<ExplainerVersion> {
  const checked = validateExplainerContent(input.content);
  if (!checked.ok) throw new ValidationError(`That Explainer is not valid: ${checked.problems.join("; ")}`);

  const [{ latest } = { latest: null }] = await tx
    .select({ latest: max(explainerVersions.number) })
    .from(explainerVersions)
    .where(eq(explainerVersions.explainerId, input.explainerId));
  const [version] = await tx
    .insert(explainerVersions)
    .values({
      explainerId: input.explainerId,
      number: (latest ?? 0) + 1,
      content: checked.value,
      cause: input.cause,
      causeDetail: input.causeDetail ?? null,
      createdAt: now,
    })
    .returning();
  const [{ topicId } = { topicId: undefined }] = await tx
    .update(explainers)
    .set({ currentVersionId: version!.id, status: "ready", failureReason: null })
    .where(eq(explainers.id, input.explainerId))
    .returning({ topicId: explainers.topicId });
  await onExplainerVersionSaved(tx, now, topicId!);
  return toVersion(version!);
}

// ---------------------------------------------------------------------------------------
// Switching form

export interface SwitchExplainerFormInput {
  topicId: string;
  form: ExplainerForm;
}

/**
 * Show the same Explainer as an infographic or as an animation. Saves a new version (cause
 * `form_switch`); the other form's data (e.g. the animation steps) is kept so switching back is free.
 * Switching to the form it already has changes nothing.
 */
export async function switchExplainerForm(deps: CoreDeps, input: SwitchExplainerFormInput): Promise<Explainer> {
  await assertTopicExists(deps, input.topicId);
  const explainer = await explainerRow(deps.db, input.topicId);
  if (!explainer) throw new NotFoundError("That Topic has no Explainer.");
  if (!explainer.currentVersionId) throw new ValidationError("The Explainer is not ready yet.");
  const [row] = await deps.db.select().from(explainerVersions).where(eq(explainerVersions.id, explainer.currentVersionId));
  const content = parseStoredContent(row!.content);
  if (content.form !== input.form) {
    let steps = content.steps;
    if (input.form === "animation" && steps.length === 0) {
      const [topic] = await deps.db.select().from(topics).where(eq(topics.id, input.topicId));
      try {
        steps = await deps.ai.generateExplainerSteps({
          topic: { name: topic!.name, description: topic!.description },
          content,
        });
      } catch (e) {
        if (e instanceof AiError) throw new ValidationError(e.message);
        throw e;
      }
    }
    const next = { ...content, form: input.form, steps };
    if (!validateExplainerContent(next).ok) throw new ValidationError(UNUSABLE_STEPS_REASON);
    await deps.db.transaction((tx) =>
      saveExplainerVersion(tx, deps.clock.now(), {
        explainerId: explainer.id,
        content: next,
        cause: "form_switch",
        causeDetail: { from: content.form, to: input.form },
      }),
    );
  }
  return (await getExplainer(deps, input.topicId))!;
}

// ---------------------------------------------------------------------------------------
// Reading

/** A Topic's Explainer, or null if it has none (no approved Source yet). */
export async function getExplainer(deps: CoreDeps, topicId: string): Promise<Explainer | null> {
  await assertTopicExists(deps, topicId);
  const explainer = await explainerRow(deps.db, topicId);
  if (!explainer) return null;

  let current: ExplainerVersion | null = null;
  if (explainer.currentVersionId) {
    const [row] = await deps.db
      .select()
      .from(explainerVersions)
      .where(eq(explainerVersions.id, explainer.currentVersionId));
    current = toVersion(row!);
  }
  return {
    topicId,
    status: explainer.status,
    failureReason: explainer.failureReason,
    current,
    passages: current ? await citedPassages(deps.db, current.content) : {},
  };
}

/** Every version of a Topic's Explainer, newest first. Empty if it has none. */
export async function listExplainerVersions(deps: CoreDeps, topicId: string): Promise<ExplainerVersionSummary[]> {
  await assertTopicExists(deps, topicId);
  return deps.db
    .select({
      id: explainerVersions.id,
      number: explainerVersions.number,
      cause: explainerVersions.cause,
      createdAt: explainerVersions.createdAt,
    })
    .from(explainerVersions)
    .innerJoin(explainers, eq(explainers.id, explainerVersions.explainerId))
    .where(eq(explainers.topicId, topicId))
    .orderBy(desc(explainerVersions.number));
}

/**
 * How many Explainers cite this Source in the version the learner studies. Shown when the
 * learner is about to delete the Source.
 */
export async function countExplainersCitingSource(deps: CoreDeps, sourceId: string): Promise<number> {
  await sourceRow(deps, sourceId);
  const citesSource = { keyPoints: [{ citations: [{ sourceId }] }] };
  const [row] = await deps.db
    .select({ n: count() })
    .from(explainers)
    .innerJoin(explainerVersions, eq(explainerVersions.id, explainers.currentVersionId))
    .where(sql`${explainerVersions.content} @> ${JSON.stringify(citesSource)}::jsonb`);
  return row!.n;
}

/** Resolve every citation in the content to its passage, or "Source removed". */
export async function citedPassages(db: DbOrTx, content: ExplainerContent): Promise<Record<string, CitedPassage>> {
  const citations = new Map<string, ExplainerCitation>();
  for (const point of content.keyPoints) for (const c of point.citations) citations.set(c.chunkId, c);
  if (citations.size === 0) return {};

  const rows = await db
    .select({
      chunkId: sourceChunks.id,
      sourceId: sourceChunks.sourceId,
      sourceTitle: sources.title,
      text: sourceChunks.text,
      anchor: sourceChunks.anchor,
    })
    .from(sourceChunks)
    .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
    .where(inArray(sourceChunks.id, [...citations.keys()]));
  const found = new Map(rows.map((r) => [r.chunkId, r]));

  const out: Record<string, CitedPassage> = {};
  for (const [chunkId, citation] of citations) {
    const row = found.get(chunkId);
    out[chunkId] = row
      ? { status: "available", ...row, anchor: row.anchor as ChunkAnchor }
      : { status: "source_removed", chunkId, sourceId: citation.sourceId };
  }
  return out;
}

export async function explainerRow(db: DbOrTx, topicId: string) {
  const [row] = await db.select().from(explainers).where(eq(explainers.topicId, topicId));
  return row ?? null;
}

async function assertTopicExists(deps: CoreDeps, topicId: string) {
  const [topic] = await deps.db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
}

function toVersion(row: typeof explainerVersions.$inferSelect): ExplainerVersion {
  return {
    id: row.id,
    number: row.number,
    cause: row.cause,
    createdAt: row.createdAt,
    content: parseStoredContent(row.content),
  };
}
