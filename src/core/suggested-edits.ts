import { and, asc, cosineDistance, count, eq, isNotNull, sql } from "drizzle-orm";
import {
  explainers,
  explainerVersions,
  sourceChunks,
  sources,
  suggestedEditFailures,
  suggestedEdits,
  topicSources,
  topics,
} from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { type ExplainerCitation, type ExplainerContent, parseStoredContent } from "./explainer-content";
import { type CitedPassage, citedPassages, saveExplainerVersion } from "./explainers";
import { enqueueJob } from "./jobs";
import { AiError, type SuggestedEditDraft } from "./ports/ai";
import { sourceDisplayName } from "./source-display";

export const UNEXPECTED_SUGGESTION_FAILURE = "Something went wrong while checking this Source for Suggested Edits.";

/**
 * Suggested Edits (#20, ADR 0001). Once a Topic has an Explainer it is never regenerated: a
 * newly linked Source instead brings Suggested Edits, each rewriting or adding one key point.
 * The learner accepts (a new Explainer version, cause `suggested_edit`) or rejects each one.
 */

/** The new Source's passages the AI sees when proposing edits. */
const PASSAGES_FOR_SUGGESTIONS = 6;

export type SuggestedEditKind = "adds" | "contradicts";

export interface SuggestedEdit {
  id: string;
  topicId: string;
  /** The Source the edit comes from. */
  source: { id: string; title: string | null; name: string };
  kind: SuggestedEditKind;
  /** What the Source adds or contradicts, in a sentence. */
  summary: string;
  /** The key point the edit rewrites, or null if it adds a new one. */
  keyPointId: string | null;
  /** That key point's text in the current Explainer (null for a new point, or if the learner removed it). */
  currentText: string | null;
  proposedText: string;
  /** The new Source's passages the proposed text cites. */
  passages: CitedPassage[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------------------
// Hooks (called from explainers.ts)

/** A Source was linked to a Topic whose Explainer already has a version: queue Suggested Edits. */
export async function queueSuggestedEdits(tx: DbOrTx, now: Date, link: { topicId: string; sourceId: string }) {
  await enqueueJob(tx, now, "suggest_edits", link);
}

/**
 * A Source's text was just captured. Topics it is linked to whose Explainer already has a
 * version, and that have no Suggested Edits from it yet, are queued (e.g. a Source linked by
 * hand before it was processed, or one retried after failing).
 */
export async function onSourceTextCapturedForSuggestions(tx: DbOrTx, now: Date, sourceId: string) {
  const linked = await tx
    .select({ topicId: topicSources.topicId })
    .from(topicSources)
    .innerJoin(explainers, eq(explainers.topicId, topicSources.topicId))
    .where(and(eq(topicSources.sourceId, sourceId), isNotNull(explainers.currentVersionId)));
  for (const { topicId } of linked) {
    if (!(await hasSuggestionsFrom(tx, topicId, sourceId))) await queueSuggestedEdits(tx, now, { topicId, sourceId });
  }
}

async function hasSuggestionsFrom(db: DbOrTx, topicId: string, sourceId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(suggestedEdits)
    .where(and(eq(suggestedEdits.topicId, topicId), eq(suggestedEdits.sourceId, sourceId)));
  return row!.n > 0;
}

// ---------------------------------------------------------------------------------------
// The suggest_edits job

/**
 * Ask the AI what the newly linked Source adds to or contradicts in the Topic's Explainer, and
 * keep each usable answer as a pending Suggested Edit. Never saves an Explainer version.
 * Does nothing if the Source has no text yet (it is queued again once it has) or already
 * brought Suggested Edits to this Topic. If the AI call fails, the failure is recorded for the
 * Topic page (with a Retry, see retrySuggestedEdits) and the job fails (details in jobs.last_error).
 */
export async function suggestEdits(deps: CoreDeps, link: { topicId: string; sourceId: string }): Promise<void> {
  const [row] = await deps.db
    .select({ topic: topics, source: sources, versionId: explainers.currentVersionId })
    .from(topicSources)
    .innerJoin(topics, eq(topics.id, topicSources.topicId))
    .innerJoin(sources, eq(sources.id, topicSources.sourceId))
    .innerJoin(explainers, eq(explainers.topicId, topicSources.topicId))
    .where(and(eq(topicSources.topicId, link.topicId), eq(topicSources.sourceId, link.sourceId)));
  if (!row?.versionId) return;
  if (await hasSuggestionsFrom(deps.db, link.topicId, link.sourceId)) return;

  const passages = await deps.db
    .select({ chunkId: sourceChunks.id, text: sourceChunks.text })
    .from(sourceChunks)
    .where(eq(sourceChunks.sourceId, link.sourceId))
    .orderBy(cosineDistance(sourceChunks.embedding, row.topic.embedding), asc(sourceChunks.ordinal))
    .limit(PASSAGES_FOR_SUGGESTIONS);
  if (passages.length === 0) return;

  const [version] = await deps.db.select().from(explainerVersions).where(eq(explainerVersions.id, row.versionId));
  const content = parseStoredContent(version!.content);
  let drafts: unknown;
  try {
    drafts = await deps.ai.suggestEdits({
      topic: { name: row.topic.name, description: row.topic.description },
      explainer: content,
      source: { title: row.source.title },
      passages: passages.map((p) => ({ ...p, sourceTitle: row.source.title })),
    });
  } catch (e) {
    // Shown on the Topic with a Retry; the job still fails so the details stay in jobs.last_error.
    const reason = e instanceof AiError ? e.message : UNEXPECTED_SUGGESTION_FAILURE;
    const failedAt = deps.clock.now();
    await deps.db
      .insert(suggestedEditFailures)
      .values({ topicId: link.topicId, sourceId: link.sourceId, reason, failedAt })
      .onConflictDoUpdate({ target: [suggestedEditFailures.topicId, suggestedEditFailures.sourceId], set: { reason, failedAt } });
    throw e;
  }
  await deps.db
    .delete(suggestedEditFailures)
    .where(and(eq(suggestedEditFailures.topicId, link.topicId), eq(suggestedEditFailures.sourceId, link.sourceId)));

  const chunkIds = new Set(passages.map((p) => p.chunkId));
  const usable = (Array.isArray(drafts) ? drafts : []).flatMap((d) => {
    const edit = usableDraft(d, content, chunkIds);
    if (!edit) console.warn("Unusable Suggested Edit dropped:", JSON.stringify(d));
    return edit ? [edit] : [];
  });
  if (usable.length === 0) return;
  const now = deps.clock.now();
  await deps.db.insert(suggestedEdits).values(
    usable.map((edit, position) => ({
      topicId: link.topicId,
      sourceId: link.sourceId,
      kind: edit.kind,
      summary: edit.summary,
      keyPointId: edit.keyPointId,
      text: edit.text,
      citations: edit.citations.map(({ chunkId }) => ({ chunkId, sourceId: link.sourceId })),
      baseVersionId: row.versionId,
      position,
      createdAt: now,
    })),
  );
}

/** A draft trimmed and checked against the Explainer and the passages given, or null. */
function usableDraft(draft: unknown, content: ExplainerContent, chunkIds: Set<string>): SuggestedEditDraft | null {
  if (typeof draft !== "object" || draft === null) return null;
  const d = draft as Record<string, unknown>;
  if (d.kind !== "adds" && d.kind !== "contradicts") return null;
  const summary = typeof d.summary === "string" ? d.summary.trim() : "";
  const text = typeof d.text === "string" ? d.text.trim() : "";
  if (!summary || !text) return null;
  const keyPointId = d.keyPointId ?? null;
  if (keyPointId !== null && !content.keyPoints.some((k) => k.id === keyPointId)) return null;
  if (!Array.isArray(d.citations)) return null;
  const cited = [
    ...new Set(d.citations.map((c) => (c as { chunkId?: unknown } | null)?.chunkId).filter((c) => typeof c === "string")),
  ] as string[];
  if (cited.length === 0 || cited.some((c) => !chunkIds.has(c))) return null;
  return { kind: d.kind, summary, keyPointId: keyPointId as string | null, text, citations: cited.map((chunkId) => ({ chunkId })) };
}

// ---------------------------------------------------------------------------------------
// Reading

async function topicIdOf(db: DbOrTx, topicId: string): Promise<string> {
  const [topic] = await db.select({ id: topics.id }).from(topics).where(sql`${topics.id}::text = ${topicId}`);
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
  return topic.id;
}

/** The Topic's pending Suggested Edits, oldest first. */
export async function listSuggestedEdits(deps: CoreDeps, topicIdInput: string): Promise<SuggestedEdit[]> {
  const topicId = await topicIdOf(deps.db, topicIdInput);
  const rows = await deps.db
    .select({ edit: suggestedEdits, source: { kind: sources.kind, title: sources.title, reference: sources.reference, text: sources.text } })
    .from(suggestedEdits)
    .innerJoin(sources, eq(sources.id, suggestedEdits.sourceId))
    .where(and(eq(suggestedEdits.topicId, topicId), eq(suggestedEdits.status, "pending")))
    .orderBy(asc(suggestedEdits.createdAt), asc(suggestedEdits.position));
  if (rows.length === 0) return [];

  const current = await currentContentOf(deps.db, topicId);
  const out: SuggestedEdit[] = [];
  for (const { edit, source } of rows) {
    const passages = await citedPassages(deps.db, citingContent(edit.citations));
    out.push({
      id: edit.id,
      topicId: edit.topicId,
      source: { id: edit.sourceId, title: source.title, name: sourceDisplayName(source) },
      kind: edit.kind,
      summary: edit.summary,
      keyPointId: edit.keyPointId,
      currentText: current?.content.keyPoints.find((k) => k.id === edit.keyPointId)?.text ?? null,
      proposedText: edit.text,
      passages: edit.citations.map((c) => passages[c.chunkId]!),
      createdAt: edit.createdAt,
    });
  }
  return out;
}

export interface SuggestedEditFailure {
  /** The linked Source that could not be checked for Suggested Edits. */
  source: { id: string; title: string | null; name: string };
  reason: string;
}

/** Linked Sources whose check for Suggested Edits failed, oldest first. Each can be retried. */
export async function listSuggestedEditFailures(deps: CoreDeps, topicIdInput: string): Promise<SuggestedEditFailure[]> {
  const topicId = await topicIdOf(deps.db, topicIdInput);
  const rows = await deps.db
    .select({
      sourceId: sources.id,
      source: { kind: sources.kind, title: sources.title, reference: sources.reference, text: sources.text },
      reason: suggestedEditFailures.reason,
    })
    .from(suggestedEditFailures)
    .innerJoin(sources, eq(sources.id, suggestedEditFailures.sourceId))
    .where(eq(suggestedEditFailures.topicId, topicId))
    .orderBy(asc(suggestedEditFailures.failedAt));
  return rows.map((r) => ({
    source: { id: r.sourceId, title: r.source.title, name: sourceDisplayName(r.source) },
    reason: r.reason,
  }));
}

/** Check a Source again for Suggested Edits after the check failed (queues the job again). */
export async function retrySuggestedEdits(deps: CoreDeps, link: { topicId: string; sourceId: string }): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [failure] = await tx
      .delete(suggestedEditFailures)
      .where(
        and(
          sql`${suggestedEditFailures.topicId}::text = ${link.topicId}`,
          sql`${suggestedEditFailures.sourceId}::text = ${link.sourceId}`,
        ),
      )
      .returning();
    if (!failure) throw new ValidationError("That Source's check for Suggested Edits didn't fail, so there is nothing to retry.");
    await queueSuggestedEdits(tx, deps.clock.now(), { topicId: failure.topicId, sourceId: failure.sourceId });
  });
}

/** How many pending Suggested Edits each Topic has, for Topics that have any. Flags them in the Topic list. */
export async function pendingSuggestedEditCounts(deps: CoreDeps): Promise<Record<string, number>> {
  const rows = await deps.db
    .select({ topicId: suggestedEdits.topicId, n: count() })
    .from(suggestedEdits)
    .where(eq(suggestedEdits.status, "pending"))
    .groupBy(suggestedEdits.topicId);
  return Object.fromEntries(rows.map((r) => [r.topicId, r.n]));
}

// ---------------------------------------------------------------------------------------
// Deciding

/**
 * Apply a pending Suggested Edit to the Explainer as the learner studies it now: only the one
 * key point changes (or is added at the end), so the learner's other edits stay. Saves a new
 * version (cause `suggested_edit`, causeDetail `{suggestedEditId, keyPointId}`), which queues
 * Recall Prompt reconciliation. Refused if the key point it rewrites has since been removed.
 */
export async function acceptSuggestedEdit(deps: CoreDeps, suggestedEditId: string): Promise<void> {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    // Deciding is a conditional update: of two accepts sent at once, only one finds it pending.
    const edit = await decide(tx, suggestedEditId, "accepted", now);
    // Lock the Explainer so the edit applies to the content as it is now, not a stale read.
    const [explainer] = await tx.select().from(explainers).where(eq(explainers.topicId, edit.topicId)).for("update");
    const current = await currentContentOf(tx, edit.topicId);
    if (!explainer || !current) throw new ValidationError("The Explainer is not ready yet.");
    const { content } = current;

    let keyPointId = edit.keyPointId;
    let keyPoints;
    if (keyPointId === null) {
      keyPointId = freshKeyPointId(content);
      keyPoints = [...content.keyPoints, { id: keyPointId, text: edit.text, citations: edit.citations }];
    } else {
      const target = content.keyPoints.find((k) => k.id === keyPointId);
      if (!target) {
        throw new ValidationError("The key point this Suggested Edit changes is no longer in your Explainer. Reject it instead.");
      }
      keyPoints = content.keyPoints.map((k) =>
        k.id === keyPointId ? { ...k, text: edit.text, citations: mergeCitations(k.citations, edit.citations) } : k,
      );
    }

    await saveExplainerVersion(tx, now, {
      explainerId: explainer.id,
      content: { ...content, keyPoints },
      cause: "suggested_edit",
      causeDetail: { suggestedEditId: edit.id, keyPointId },
    });
  });
}

/** Turn down a pending Suggested Edit. The Explainer does not change. */
export async function rejectSuggestedEdit(deps: CoreDeps, suggestedEditId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await decide(tx, suggestedEditId, "rejected", deps.clock.now());
  });
}

/** Mark a pending Suggested Edit decided, or throw: NotFoundError if unknown, ValidationError if already decided. */
async function decide(tx: DbOrTx, id: string, status: "accepted" | "rejected", now: Date) {
  const [edit] = await tx
    .update(suggestedEdits)
    .set({ status, decidedAt: now })
    .where(and(sql`${suggestedEdits.id}::text = ${id}`, eq(suggestedEdits.status, "pending")))
    .returning();
  if (edit) return edit;
  const [existing] = await tx
    .select({ status: suggestedEdits.status })
    .from(suggestedEdits)
    .where(sql`${suggestedEdits.id}::text = ${id}`);
  if (!existing) throw new NotFoundError("That Suggested Edit no longer exists.");
  throw new ValidationError(`That Suggested Edit was already ${existing.status}.`);
}

async function currentContentOf(db: DbOrTx, topicId: string) {
  const [row] = await db
    .select({ id: explainerVersions.id, content: explainerVersions.content })
    .from(explainers)
    .innerJoin(explainerVersions, eq(explainerVersions.id, explainers.currentVersionId))
    .where(eq(explainers.topicId, topicId));
  return row ? { versionId: row.id, content: parseStoredContent(row.content) } : null;
}

/** Content holding just these citations, so `citedPassages` can resolve them. */
function citingContent(citations: ExplainerCitation[]): ExplainerContent {
  return { keyPoints: [{ id: "x", text: "x", citations }] } as ExplainerContent;
}

function mergeCitations(a: ExplainerCitation[], b: ExplainerCitation[]): ExplainerCitation[] {
  return [...a, ...b.filter((c) => !a.some((x) => x.chunkId === c.chunkId))];
}

function freshKeyPointId(content: ExplainerContent): string {
  const used = new Set(content.keyPoints.map((k) => k.id));
  let n = used.size + 1;
  while (used.has(`kp${n}`)) n++;
  return `kp${n}`;
}
