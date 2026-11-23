import { and, eq, inArray, isNull } from "drizzle-orm";
import { recallPrompts } from "@/db/schema";
import type { CoreDeps } from "./core";
import type { ExplainerContent } from "./explainer-content";
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
 */

export const UNUSABLE_RECONCILIATION = "The AI produced a Recall Prompt reconciliation that could not be used.";

export interface ReconcileInput {
  topic: { id: string; name: string; description: string | null };
  /** The Explainer's current version. */
  versionId: string;
  content: ExplainerContent;
}

export async function reconcileRecallPrompts(deps: CoreDeps, input: ReconcileInput): Promise<void> {
  const live = await deps.db
    .select()
    .from(recallPrompts)
    .where(and(eq(recallPrompts.topicId, input.topic.id), isNull(recallPrompts.deletedAt)));

  // Already reconciled with this version (e.g. a second queued job after two quick edits).
  if (live.some((p) => p.origin === "generated" && p.explainerVersionId === input.versionId)) return;

  const judged = live.filter((p) => p.origin === "generated" && p.state !== "retired");
  const learner = live.filter((p) => p.origin !== "generated" && p.state !== "retired");

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

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    if (kept.length > 0) {
      // Only the link to the version they were checked against changes; schedule and wording stay.
      await tx.update(recallPrompts).set({ explainerVersionId: input.versionId }).where(inArray(recallPrompts.id, kept));
    }
    if (retired.length > 0) {
      await tx.update(recallPrompts).set({ state: "retired", updatedAt: now }).where(inArray(recallPrompts.id, retired));
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
