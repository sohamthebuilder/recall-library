import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recallPrompts, reviewSessions, tags, topics, topicTags } from "@/db/schema";
import type { CoreDeps } from "./core";
import { NotFoundError } from "./errors";
import { toRecallPrompt } from "./recall-prompts";
import { interleave, type ReviewSession, reviewSession } from "./reviews";

/**
 * Practice: Reviews the learner chooses to do before their prompts are due, over a Topic or a
 * Tag. They are done in a Practice session (one open at a time, separate from the scheduled
 * one) and recorded as Practice Reviews; only a poor grade changes the schedule (reviews.ts).
 */

export type PracticeScope = { topicId: string } | { tagId: string };

/**
 * Start Practice over every active prompt of a Topic, or of the Topics with a Tag, due or not
 * (soonest due first, interleaved across Topics). It replaces any open Practice session.
 * Null when there is nothing to practise.
 */
export async function startPractice(deps: CoreDeps, scope: PracticeScope): Promise<ReviewSession | null> {
  const topicIds = await scopeTopicIds(deps, scope);
  const rows =
    topicIds.length === 0
      ? []
      : await deps.db
          .select({ prompt: recallPrompts, topicName: topics.name })
          .from(recallPrompts)
          .innerJoin(topics, eq(topics.id, recallPrompts.topicId))
          .where(and(inArray(recallPrompts.topicId, topicIds), eq(recallPrompts.state, "active"), isNull(recallPrompts.deletedAt)))
          .orderBy(asc(recallPrompts.due), asc(recallPrompts.createdAt), asc(recallPrompts.id));
  const prompts = interleave(rows.map((r) => ({ ...toRecallPrompt(r.prompt), topicName: r.topicName })));

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(reviewSessions)
      .set({ finishedAt: now })
      .where(and(eq(reviewSessions.kind, "practice"), isNull(reviewSessions.finishedAt)));
    if (prompts.length > 0) {
      await tx.insert(reviewSessions).values({ kind: "practice", promptIds: prompts.map((p) => p.id), startedAt: now });
    }
  });
  return prompts.length > 0 ? reviewSession(deps, "practice") : null;
}

/** The open Practice session, or null. */
export function practiceSession(deps: CoreDeps): Promise<ReviewSession | null> {
  return reviewSession(deps, "practice");
}

async function scopeTopicIds(deps: CoreDeps, scope: PracticeScope): Promise<string[]> {
  if ("topicId" in scope) {
    const [topic] = await deps.db.select({ id: topics.id }).from(topics).where(sql`${topics.id}::text = ${scope.topicId}`);
    if (!topic) throw new NotFoundError("That Topic no longer exists.");
    return [topic.id];
  }
  const [tag] = await deps.db.select({ id: tags.id }).from(tags).where(sql`${tags.id}::text = ${scope.tagId}`);
  if (!tag) throw new NotFoundError("That Tag no longer exists.");
  const rows = await deps.db.select({ topicId: topicTags.topicId }).from(topicTags).where(eq(topicTags.tagId, tag.id));
  return rows.map((r) => r.topicId);
}
