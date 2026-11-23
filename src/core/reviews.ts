import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { explainers, explainerVersions, recallPrompts, reviewSessions, reviews, topics } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { type ExplainerKeyPoint, parseStoredContent } from "./explainer-content";
import { AiError, type ReviewRating } from "./ports/ai";
import { type RecallPrompt, toRecallPrompt } from "./recall-prompts";
import { memoryStateOf, parseMemoryState, schedule, serializeMemoryState } from "./scheduling";

export type { ReviewRating } from "./ports/ai";
export type ReviewKind = "scheduled" | "practice";

export interface Review {
  id: string;
  promptId: string;
  topicId: string;
  sessionId: string | null;
  kind: ReviewKind;
  /** The question as worded when it was answered. */
  question: string;
  answer: string;
  aiRating: ReviewRating;
  /** The final rating: the AI's, or the learner's if they overruled it. */
  rating: ReviewRating;
  overruled: boolean;
  pointsCovered: string[];
  pointsMissed: string[];
  /** The part of the Explainer (as graded against) the answer is about. */
  explainerKeyPoints: ExplainerKeyPoint[];
  reviewedAt: Date;
}

/**
 * Reviews and the due queue. A Review is one answer to a Recall Prompt, graded by the AI
 * (the learner can overrule it); the final rating updates the prompt's FSRS memory state
 * (see scheduling.ts). Due Reviews are done in a Review session that is saved server-side.
 */

/** The fixed time a Review is assumed to take, for the home screen's estimate. */
export const MINUTES_PER_REVIEW = 2;

export interface DuePrompt extends RecallPrompt {
  topicName: string;
}

export interface DueQueue {
  /** Due prompts, interleaved across Topics. */
  prompts: DuePrompt[];
  estimatedMinutes: number;
}

export interface DueOptions {
  /** The learner's IANA time zone, which decides when "today" ends. Defaults to UTC. */
  timeZone?: string;
}

/** Every active prompt due by the end of today, interleaved across Topics. */
export async function dueRecallPrompts(deps: CoreDeps, options: DueOptions = {}): Promise<DueQueue> {
  const prompts = await duePrompts(deps.db, endOfDay(deps.clock.now(), options.timeZone ?? "UTC"));
  return { prompts, estimatedMinutes: prompts.length * MINUTES_PER_REVIEW };
}

async function duePrompts(db: DbOrTx, cutoff: Date): Promise<DuePrompt[]> {
  const rows = await db
    .select({ prompt: recallPrompts, topicName: topics.name })
    .from(recallPrompts)
    .innerJoin(topics, eq(topics.id, recallPrompts.topicId))
    .where(and(eq(recallPrompts.state, "active"), isNull(recallPrompts.deletedAt), lte(recallPrompts.due, cutoff)))
    .orderBy(asc(recallPrompts.due), asc(recallPrompts.createdAt), asc(recallPrompts.id));
  return interleave(rows.map((r) => ({ ...toRecallPrompt(r.prompt), topicName: r.topicName })));
}

/**
 * Round-robin across Topics, so a run of related questions is broken up: Topics take turns
 * in order of their most overdue prompt, and each Topic's prompts stay most overdue first.
 */
function interleave(prompts: DuePrompt[]): DuePrompt[] {
  const byTopic = new Map<string, DuePrompt[]>();
  for (const p of prompts) byTopic.set(p.topicId, [...(byTopic.get(p.topicId) ?? []), p]);
  const queues = [...byTopic.values()];
  const result: DuePrompt[] = [];
  for (let round = 0; result.length < prompts.length; round++) {
    for (const q of queues) if (q[round]) result.push(q[round]!);
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Review sessions

export interface ReviewSession {
  id: string;
  startedAt: Date;
  /** Prompts reviewed in this session. */
  done: number;
  /** Prompts still to review (paused or deleted ones drop out). */
  remaining: number;
  /** The prompt to answer now, as currently worded. */
  current: DuePrompt;
  /** The session's most recent Review, so a resumed session can show (and overrule) it. */
  lastReview: Review | null;
}

/**
 * Resume the open Review session, or start one over today's due queue (its order is kept).
 * Null when nothing is due.
 */
export async function startReview(deps: CoreDeps, options: DueOptions = {}): Promise<ReviewSession | null> {
  const open = await reviewSession(deps);
  if (open) return open;
  const { prompts } = await dueRecallPrompts(deps, options);
  if (prompts.length === 0) return null;
  // The partial unique index allows one open session: a concurrent start just resumes the winner's.
  await deps.db
    .insert(reviewSessions)
    .values({ kind: "scheduled", promptIds: prompts.map((p) => p.id), startedAt: deps.clock.now() })
    .onConflictDoNothing();
  return reviewSession(deps);
}

/** The open Review session, or null. A session with nothing left to review is finished. */
export async function reviewSession(deps: CoreDeps): Promise<ReviewSession | null> {
  const [session] = await deps.db
    .select()
    .from(reviewSessions)
    .where(and(eq(reviewSessions.kind, "scheduled"), isNull(reviewSessions.finishedAt)));
  if (!session) return null;

  const done = await selectReviews(deps.db)
    .where(eq(reviews.sessionId, session.id))
    .orderBy(asc(reviews.reviewedAt), asc(reviews.id));
  const reviewed = new Set(done.map((r) => r.review.promptId));
  const pending = session.promptIds.filter((id) => !reviewed.has(id));
  const live =
    pending.length === 0
      ? []
      : await deps.db
          .select({ prompt: recallPrompts, topicName: topics.name })
          .from(recallPrompts)
          .innerJoin(topics, eq(topics.id, recallPrompts.topicId))
          .where(and(inArray(recallPrompts.id, pending), eq(recallPrompts.state, "active"), isNull(recallPrompts.deletedAt)));
  const byId = new Map(live.map((r) => [r.prompt.id, { ...toRecallPrompt(r.prompt), topicName: r.topicName }]));
  const remaining = pending.flatMap((id) => byId.get(id) ?? []);

  if (remaining.length === 0) {
    await deps.db.update(reviewSessions).set({ finishedAt: deps.clock.now() }).where(eq(reviewSessions.id, session.id));
    return null;
  }
  const last = done.at(-1);
  return {
    id: session.id,
    startedAt: session.startedAt,
    done: reviewed.size,
    remaining: remaining.length,
    current: remaining[0]!,
    lastReview: last ? toReview(last) : null,
  };
}

// ---------------------------------------------------------------------------------------
// Submitting a Review

export interface SubmitReviewInput {
  promptId: string;
  /** Typed (or, #7, transcribed and corrected) answer. */
  answer: string;
  /** The Review session it was answered in, if any. */
  sessionId?: string;
}

export const UNUSABLE_GRADE = "The AI's grade could not be used. Try submitting again.";

const gradeSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]),
  pointsCovered: z.array(z.string().trim()).transform(nonBlank),
  pointsMissed: z.array(z.string().trim()).transform(nonBlank),
  relevantKeyPointIds: z.array(z.string()),
});

function nonBlank(ps: string[]): string[] {
  return ps.filter((p) => p.length > 0);
}

/**
 * The AI grades the answer against the prompt's expected points and the Topic's current
 * Explainer; the rating updates the prompt's FSRS memory state. Nothing changes if grading fails.
 */
export async function submitReview(deps: CoreDeps, input: SubmitReviewInput): Promise<Review> {
  const answer = input.answer.trim();
  if (!answer) throw new ValidationError("Write your answer first.");
  const prompt = await reviewablePrompt(deps.db, input.promptId);
  if (input.sessionId !== undefined) {
    const [session] = await deps.db
      .select()
      .from(reviewSessions)
      .where(and(sql`${reviewSessions.id}::text = ${input.sessionId}`, isNull(reviewSessions.finishedAt)));
    if (!session) throw new NotFoundError("That Review session has finished.");
    if (!session.promptIds.includes(prompt.id)) throw new ValidationError("That Recall Prompt is not in this Review session.");
  }

  const [context] = await deps.db
    .select({ topic: topics, versionId: explainerVersions.id, content: explainerVersions.content })
    .from(topics)
    .leftJoin(explainers, eq(explainers.topicId, topics.id))
    .leftJoin(explainerVersions, eq(explainerVersions.id, explainers.currentVersionId))
    .where(eq(topics.id, prompt.topicId));
  const explainer = context!.content ? parseStoredContent(context!.content) : null;

  const parsed = gradeSchema.safeParse(
    await deps.ai.gradeAnswer({
      topic: { name: context!.topic.name, description: context!.topic.description },
      question: prompt.question,
      expectedPoints: prompt.expectedPoints,
      answer,
      explainer,
    }),
  );
  if (!parsed.success) throw new AiError(UNUSABLE_GRADE);
  const grade = parsed.data;
  const keyPointIds = new Set(explainer?.keyPoints.map((k) => k.id) ?? []);

  const now = deps.clock.now();
  const before = memoryStateOf(prompt);
  const id = await deps.db.transaction(async (tx) => {
    await tx.update(recallPrompts).set(schedule(before, grade.rating, now)).where(eq(recallPrompts.id, prompt.id));
    const [row] = await tx
      .insert(reviews)
      .values({
        promptId: prompt.id,
        sessionId: input.sessionId ?? null,
        kind: "scheduled",
        question: prompt.question,
        answer,
        aiRating: grade.rating,
        rating: grade.rating,
        pointsCovered: grade.pointsCovered,
        pointsMissed: grade.pointsMissed,
        explainerVersionId: context!.versionId,
        relevantKeyPointIds: grade.relevantKeyPointIds.filter((k) => keyPointIds.has(k)),
        cardBefore: serializeMemoryState(before),
        reviewedAt: now,
      })
      .returning({ id: reviews.id });
    return row!.id;
  });
  return getReview(deps.db, id);
}

export interface OverruleGradeInput {
  reviewId: string;
  rating: ReviewRating;
}

/**
 * The learner replaces the Review's rating. The prompt is rescheduled from its memory state
 * before that Review, as of when it happened, so the final rating alone decides the outcome.
 * Only a prompt's latest Review can be overruled (later Reviews were scheduled from it).
 */
export async function overruleGrade(deps: CoreDeps, input: OverruleGradeInput): Promise<Review> {
  const rating = z.enum(["again", "hard", "good", "easy"]).safeParse(input.rating);
  if (!rating.success) throw new ValidationError("Choose a grade: Again, Hard, Good or Easy.");
  await deps.db.transaction(async (tx) => {
    const [review] = await tx.select().from(reviews).where(sql`${reviews.id}::text = ${input.reviewId}`).for("update");
    if (!review) throw new NotFoundError("That Review no longer exists.");
    const [latest] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.promptId, review.promptId))
      .orderBy(desc(reviews.reviewedAt), desc(reviews.id))
      .limit(1);
    if (latest!.id !== review.id) throw new ValidationError("Only the latest Review of a prompt can be overruled.");

    const after = schedule(parseMemoryState(review.cardBefore), rating.data, review.reviewedAt);
    await tx.update(recallPrompts).set(after).where(eq(recallPrompts.id, review.promptId));
    await tx
      .update(reviews)
      .set({ rating: rating.data, overruled: rating.data !== review.aiRating })
      .where(eq(reviews.id, review.id));
  });
  return getReview(deps.db, input.reviewId);
}

/** A prompt that can be reviewed now: not deleted, and active. */
/** A live, active prompt (else NotFoundError / ValidationError). */
export async function reviewablePrompt(db: DbOrTx, promptId: string) {
  const [row] = await db
    .select()
    .from(recallPrompts)
    .where(and(sql`${recallPrompts.id}::text = ${promptId}`, isNull(recallPrompts.deletedAt)));
  if (!row) throw new NotFoundError("That Recall Prompt no longer exists.");
  if (row.state !== "active") throw new ValidationError("This Recall Prompt is paused. Resume it to review it.");
  return row;
}

// ---------------------------------------------------------------------------------------
// Reading Reviews

/** A Topic's Review history, newest first. Reviews of deleted prompts are kept. */
export async function topicReviews(deps: CoreDeps, topicId: string): Promise<Review[]> {
  const [topic] = await deps.db.select({ id: topics.id }).from(topics).where(sql`${topics.id}::text = ${topicId}`);
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
  const rows = await selectReviews(deps.db)
    .where(eq(recallPrompts.topicId, topic.id))
    .orderBy(desc(reviews.reviewedAt), desc(reviews.id));
  return rows.map(toReview);
}

async function getReview(db: DbOrTx, reviewId: string): Promise<Review> {
  const [row] = await selectReviews(db).where(sql`${reviews.id}::text = ${reviewId}`);
  if (!row) throw new NotFoundError("That Review no longer exists.");
  return toReview(row);
}

function selectReviews(db: DbOrTx) {
  return db
    .select({ review: reviews, topicId: recallPrompts.topicId, content: explainerVersions.content })
    .from(reviews)
    .innerJoin(recallPrompts, eq(recallPrompts.id, reviews.promptId))
    .leftJoin(explainerVersions, eq(explainerVersions.id, reviews.explainerVersionId))
    .$dynamic();
}

function toReview(row: { review: typeof reviews.$inferSelect; topicId: string; content: unknown }): Review {
  const r = row.review;
  const keyPoints = row.content ? parseStoredContent(row.content).keyPoints : [];
  return {
    id: r.id,
    promptId: r.promptId,
    topicId: row.topicId,
    sessionId: r.sessionId,
    kind: r.kind,
    question: r.question,
    answer: r.answer,
    aiRating: r.aiRating,
    rating: r.rating,
    overruled: r.overruled,
    pointsCovered: r.pointsCovered,
    pointsMissed: r.pointsMissed,
    explainerKeyPoints: keyPoints.filter((k) => r.relevantKeyPointIds.includes(k.id)),
    reviewedAt: r.reviewedAt,
  };
}

// ---------------------------------------------------------------------------------------
// Time

/** The first instant of tomorrow in this time zone (prompts due before it are due "today"). */
export function endOfDay(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const midnightUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1);
  // Shift by the zone's offset at that moment (twice, to settle across a DST change).
  let instant = midnightUtc;
  for (let i = 0; i < 2; i++) instant = midnightUtc - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
