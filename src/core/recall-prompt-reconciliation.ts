import { and, eq, inArray, isNull } from "drizzle-orm";
import { explainers, explainerVersions, recallPrompts } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { type ExplainerContent, parseStoredContent } from "./explainer-content";
import type { RecallPromptDraft } from "./ports/ai";
import { usableDraft } from "./recall-prompts";

/**
 * Reconciling a Topic's Recall Prompts with a new current Explainer version (#17, ADR 0001).
 *
 * Only `generated` prompts that are active or paused are judged. The AI says which still fit:
 * those are kept untouched (wording, state and FSRS schedule); every other one is retired
 * (state `retired`, so its Review history stays). New prompts are added for uncovered content.
 * `learner_edited` and `learner_written` prompts are never changed; they are only shown to the
 * AI so it does not repeat them. Retired and deleted prompts are left as they are.
 *
 * A result that retires every judged prompt and adds none is refused (UNUSABLE_RECONCILIATION).
 * A form switch whose key points match what the prompts were checked against needs no AI: the
 * prompts are just linked to the new version. Writes are serialized per Topic (Explainer row
 * lock) and skipped if the version is no longer current or was already reconciled meanwhile.
 */

export const UNUSABLE_RECONCILIATION = "The AI produced a Recall Prompt reconciliation that could not be used.";

export interface ReconcileInput {
  topic: { id: string; name: string; description: string | null };
  /** The Explainer's current version. */
  versionId: string;
  content: ExplainerContent;
}

export async function reconcileRecallPrompts(deps: CoreDeps, input: ReconcileInput): Promise<void> {
  const live = await livePrompts(deps.db, input.topic.id);
  if (alreadyReconciled(live, input.versionId)) return;

  const judged = live.filter((p) => p.origin === "generated" && p.state !== "retired");
  const learner = live.filter((p) => p.origin !== "generated" && p.state !== "retired");

  // A form switch with the same key points changes nothing the prompts ask about: no AI needed.
  if (await onlyFormChanged(deps.db, input, judged)) {
    await writeIfStillCurrent(deps, input, async (tx) => {
      await tx
        .update(recallPrompts)
        .set({ explainerVersionId: input.versionId })
        .where(and(inArray(recallPrompts.id, judged.map((p) => p.id)), stillGenerated));
    });
    return;
  }

  const result = await deps.ai.reconcileRecallPrompts({
    topic: { name: input.topic.name, description: input.topic.description },
    explainer: input.content,
    prompts: judged.map((p) => ({ id: p.id, kind: p.kind, question: p.question, expectedPoints: p.expectedPoints })),
    learnerPrompts: learner.map((p) => ({ kind: p.kind, question: p.question, expectedPoints: p.expectedPoints })),
  });
  if (!result || !Array.isArray(result.keep) || !Array.isArray(result.add)) throw new Error(UNUSABLE_RECONCILIATION);

  const keepIds = new Set(result.keep.filter((id): id is string => typeof id === "string"));
  const kept = judged.filter((p) => keepIds.has(p.id)).map((p) => p.id);
  const retired = judged.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
  const added = result.add.map(usableDraft).filter((d): d is RecallPromptDraft => d !== null);
  // Retiring every generated prompt and adding none would silently empty the Topic: not trusted.
  if (judged.length > 0 && kept.length === 0 && added.length === 0) throw new Error(UNUSABLE_RECONCILIATION);

  const now = deps.clock.now();
  await writeIfStillCurrent(deps, input, async (tx) => {
    if (kept.length > 0) {
      // Only the link to the version they were checked against changes; schedule and wording stay.
      await tx
        .update(recallPrompts)
        .set({ explainerVersionId: input.versionId })
        .where(and(inArray(recallPrompts.id, kept), stillGenerated));
    }
    if (retired.length > 0) {
      await tx
        .update(recallPrompts)
        .set({ state: "retired", updatedAt: now })
        .where(and(inArray(recallPrompts.id, retired), stillGenerated));
    }
    if (added.length > 0) {
      await tx.insert(recallPrompts).values(
        added.map((d) => ({
          topicId: input.topic.id,
          kind: d.kind,
          question: d.question,
          expectedPoints: d.expectedPoints,
          origin: "generated" as const,
          explainerVersionId: input.versionId,
          createdAt: now,
          updatedAt: now,
          due: now,
        })),
      );
    }
  });
}

/** Only prompts the learner has not taken over (edited) or deleted since they were judged are written. */
const stillGenerated = and(eq(recallPrompts.origin, "generated"), isNull(recallPrompts.deletedAt));

function livePrompts(db: DbOrTx, topicId: string) {
  return db
    .select()
    .from(recallPrompts)
    .where(and(eq(recallPrompts.topicId, topicId), isNull(recallPrompts.deletedAt)));
}

/** Already reconciled with this version (e.g. a second queued job after two quick edits). */
function alreadyReconciled(live: (typeof recallPrompts.$inferSelect)[], versionId: string) {
  return live.some((p) => p.origin === "generated" && p.explainerVersionId === versionId);
}

/**
 * Write a reconciliation, one at a time per Topic: the Explainer row is locked (which also waits
 * for a version being saved), and nothing is written if a newer version became current (its own
 * job reconciles) or another job already reconciled this one while the AI was answering.
 */
async function writeIfStillCurrent(deps: CoreDeps, input: ReconcileInput, write: (tx: DbOrTx) => Promise<void>) {
  await deps.db.transaction(async (tx) => {
    const [explainer] = await tx
      .select({ currentVersionId: explainers.currentVersionId })
      .from(explainers)
      .where(eq(explainers.topicId, input.topic.id))
      .for("update");
    if (explainer?.currentVersionId !== input.versionId) return;
    if (alreadyReconciled(await livePrompts(tx, input.topic.id), input.versionId)) return;
    await write(tx);
  });
}

/**
 * The version is a form switch, and every version the judged prompts were last checked against
 * has the same key points (ids and text) as it.
 */
async function onlyFormChanged(
  db: DbOrTx,
  input: ReconcileInput,
  judged: (typeof recallPrompts.$inferSelect)[],
): Promise<boolean> {
  const [version] = await db
    .select({ cause: explainerVersions.cause })
    .from(explainerVersions)
    .where(eq(explainerVersions.id, input.versionId));
  if (version?.cause !== "form_switch" || judged.length === 0) return false;
  const checkedAgainst = [...new Set(judged.map((p) => p.explainerVersionId))];
  if (checkedAgainst.some((id) => id === null)) return false;
  const versions = await db
    .select({ content: explainerVersions.content })
    .from(explainerVersions)
    .where(inArray(explainerVersions.id, checkedAgainst as string[]));
  if (versions.length !== checkedAgainst.length) return false;
  const keyPoints = (c: ExplainerContent) => JSON.stringify(c.keyPoints.map((k) => [k.id, k.text]));
  const now = keyPoints(input.content);
  return versions.every((v) => keyPoints(parseStoredContent(v.content)) === now);
}
