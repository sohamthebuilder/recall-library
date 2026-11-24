import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { explainers, explainerVersions, recallPrompts, reviewSessions, reviews, topics } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { type ExplainerKeyPoint, parseStoredContent } from "./explainer-content";
import { AiError, type ReviewRating } from "./ports/ai";
import { type RecallPrompt, toRecallPrompt } from "./recall-prompts";
import { type MemoryState, memoryStateOf, parseMemoryState, schedule, serializeMemoryState } from "./scheduling";

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
export function interleave(prompts: DuePrompt[]): DuePrompt[] {
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
  /** Scheduled (the due queue) or Practice (prompts the learner chose, due or not). */
  kind: ReviewKind;
  startedAt: Date;
  /** Prompts reviewed in this session. */
  done: number;
  /** Prompts still to review (paused, deleted and skipped ones drop out). */
  remaining: number;
  /** Prompts skipped in this session: not graded, still due. */
  skipped: number;
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

/** The open Review session of this kind, or null. A session with nothing left to review is finished. */
export async function reviewSession(deps: CoreDeps, kind: ReviewKind = "scheduled"): Promise<ReviewSession | null> {
  const [session] = await deps.db
    .select()
    .from(reviewSessions)
    .where(and(eq(reviewSessions.kind, kind), isNull(reviewSessions.finishedAt)));
  if (!session) return null;

  const done = await selectReviews(deps.db)
    .where(eq(reviews.sessionId, session.id))
    .orderBy(asc(reviews.reviewedAt), asc(reviews.id));
  const reviewed = new Set(done.map((r) => r.review.promptId));
  const skipped = new Set(session.skippedPromptIds);
  const pending = session.promptIds.filter((id) => !reviewed.has(id) && !skipped.has(id));
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
    kind: session.kind,
    startedAt: session.startedAt,
    done: reviewed.size,
    remaining: remaining.length,
    skipped: skipped.size,
    current: remaining[0]!,
    lastReview: last ? toReview(last) : null,
  };
}

/**
 * Skip a prompt in the open session without grading it: the session moves on and the prompt's
 * schedule is untouched, so it stays due. Returns the session as it is now (null once finished).
 */
export async function skipPrompt(
  deps: CoreDeps,
  input: { sessionId: string; promptId: string },
): Promise<ReviewSession | null> {
  const [session] = await deps.db
    .select()
    .from(reviewSessions)
    .where(and(sql`${reviewSessions.id}::text = ${input.sessionId}`, isNull(reviewSessions.finishedAt)));
  if (!session) throw new NotFoundError("That Review session has finished.");
  if (!session.promptIds.includes(input.promptId)) throw new ValidationError("That Recall Prompt is not in this Review session.");
  if (!session.skippedPromptIds.includes(input.promptId)) {
    await deps.db
      .update(reviewSessions)
      .set({ skippedPromptIds: [...session.skippedPromptIds, input.promptId] })
      .where(eq(reviewSessions.id, session.id));
  }
  return reviewSession(deps, session.kind);
}

export interface ReviewSummary {
  kind: ReviewKind;
  /** Prompts graded in the session. */
  reviewed: number;
  /** Prompts skipped: not graded, still due. */
  skipped: number;
  /** How many final ratings of each grade. */
  ratings: Record<ReviewRating, number>;
  /** Prompts graded Again, which come back within the day. */
  comingBackSoon: number;
  /** The Topic answered worst (lowest average grade), if any answer was Again or Hard. */
  weakestTopic: { id: string; name: string } | null;
}

const RATING_SCORE: Record<ReviewRating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

/** What a Review session (open or finished) came to: shown when the learner finishes it. */
export async function reviewSummary(deps: CoreDeps, sessionId: string): Promise<ReviewSummary> {
  const [session] = await deps.db.select().from(reviewSessions).where(sql`${reviewSessions.id}::text = ${sessionId}`);
  if (!session) throw new NotFoundError("That Review session no longer exists.");
  const rows = await deps.db
    .select({ rating: reviews.rating, topicId: topics.id, topicName: topics.name })
    .from(reviews)
    .innerJoin(recallPrompts, eq(recallPrompts.id, reviews.promptId))
    .innerJoin(topics, eq(topics.id, recallPrompts.topicId))
    .where(eq(reviews.sessionId, session.id));

  const ratings: Record<ReviewRating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  const byTopic = new Map<string, { name: string; total: number; count: number; struggled: boolean }>();
  for (const r of rows) {
    ratings[r.rating]++;
    const t = byTopic.get(r.topicId) ?? { name: r.topicName, total: 0, count: 0, struggled: false };
    t.total += RATING_SCORE[r.rating];
    t.count++;
    t.struggled ||= r.rating === "again" || r.rating === "hard";
    byTopic.set(r.topicId, t);
  }
  const weakest = [...byTopic.entries()]
    .filter(([, t]) => t.struggled)
    .sort(([, a], [, b]) => a.total / a.count - b.total / b.count || a.name.localeCompare(b.name))[0];

  return {
    kind: session.kind,
    reviewed: rows.length,
    skipped: session.skippedPromptIds.length,
    ratings,
    comingBackSoon: ratings.again,
    weakestTopic: weakest ? { id: weakest[0], name: weakest[1].name } : null,
  };
}

// ---------------------------------------------------------------------------------------
// Submitting a Review

export interface SubmitReviewInput {
  promptId: string;
  /** Typed (or, #7, transcribed and corrected) answer. */
  answer: string;
  /** The Review session it was answered in, if any. An answer in a Practice session is a Practice Review. */
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
  let kind: ReviewKind = "scheduled";
  if (input.sessionId !== undefined) {
    const [session] = await deps.db
      .select()
      .from(reviewSessions)
      .where(and(sql`${reviewSessions.id}::text = ${input.sessionId}`, isNull(reviewSessions.finishedAt)));
    if (!session) throw new NotFoundError("That Review session has finished.");
    if (!session.promptIds.includes(prompt.id)) throw new ValidationError("That Recall Prompt is not in this Review session.");
    kind = session.kind;
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
  const id = await deps.db.transaction(async (tx) => {
    // Lock the prompt so a double submit waits here, then read its schedule as it is now.
    const [locked] = await tx.select().from(recallPrompts).where(eq(recallPrompts.id, prompt.id)).for("update");
    if (!locked || locked.deletedAt) throw new NotFoundError("That Recall Prompt no longer exists.");
    if (locked.state !== "active") throw new ValidationError("This Recall Prompt is paused. Resume it to review it.");
    if (input.sessionId !== undefined) {
      const [already] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.promptId, prompt.id), sql`${reviews.sessionId}::text = ${input.sessionId}`))
        .limit(1);
      if (already) throw new ValidationError("You have already answered this Recall Prompt in this session.");
    }
    const before = memoryStateOf(locked);
    await tx.update(recallPrompts).set(reschedule(kind, before, grade.rating, now)).where(eq(recallPrompts.id, prompt.id));
    const [row] = await tx
      .insert(reviews)
      .values({
        promptId: prompt.id,
        sessionId: input.sessionId ?? null,
        kind,
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
 * Only a prompt's latest Review can be overruled (later Reviews were scheduled from it), and only
 * while the prompt is active: a deleted, paused or retired prompt's grade is refused (ValidationError).
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
    // Rescheduling a deleted or paused prompt would bring it back on its own; refuse instead
    // (the learner can resume a paused prompt, then change the grade).
    const [prompt] = await tx.select().from(recallPrompts).where(eq(recallPrompts.id, review.promptId)).for("update");
    if (!prompt || prompt.deletedAt) throw new ValidationError("That Recall Prompt was deleted, so its grade can't be changed.");
    if (prompt.state !== "active") {
      throw new ValidationError("This Recall Prompt is paused or retired. Resume it to change its grade.");
    }

    const after = reschedule(review.kind, parseMemoryState(review.cardBefore), rating.data, review.reviewedAt);
    await tx.update(recallPrompts).set(after).where(eq(recallPrompts.id, review.promptId));
    await tx
      .update(reviews)
      .set({ rating: rating.data, overruled: rating.data !== review.aiRating })
      .where(eq(reviews.id, review.id));
  });
  return getReview(deps.db, input.reviewId);
}

/**
 * Undo a grade given in the open Review session: the Review is removed, the prompt's schedule
 * goes back to what it was before it, and the prompt is current again. Only the prompt's latest
 * Review, and only while its session is open. Returns the session as it is now.
 */
export async function undoReview(deps: CoreDeps, reviewId: string): Promise<ReviewSession | null> {
  const kind = await deps.db.transaction(async (tx) => {
    const [review] = await tx.select().from(reviews).where(sql`${reviews.id}::text = ${reviewId}`).for("update");
    if (!review) throw new NotFoundError("That Review no longer exists.");
    const [session] = review.sessionId
      ? await tx
          .select()
          .from(reviewSessions)
          .where(and(eq(reviewSessions.id, review.sessionId), isNull(reviewSessions.finishedAt)))
      : [];
    if (!session) throw new NotFoundError("That Review session has finished.");
    const [latest] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.promptId, review.promptId))
      .orderBy(desc(reviews.reviewedAt), desc(reviews.id))
      .limit(1);
    if (latest!.id !== review.id) throw new ValidationError("Only the latest grade of a prompt can be undone.");
    const [prompt] = await tx.select().from(recallPrompts).where(eq(recallPrompts.id, review.promptId)).for("update");
    if (prompt && !prompt.deletedAt) {
      await tx.update(recallPrompts).set(parseMemoryState(review.cardBefore)).where(eq(recallPrompts.id, review.promptId));
    }
    await tx.delete(reviews).where(eq(reviews.id, review.id));
    return session.kind;
  });
  return reviewSession(deps, kind);
}

/**
 * The prompt's memory state after a Review. A Practice Review only counts when it went badly:
 * Again reschedules the prompt (bringing it back sooner); Hard, Good or Easy leave it as it was,
 * so practising never pushes a prompt further out.
 */
function reschedule(kind: ReviewKind, before: MemoryState, rating: ReviewRating, at: Date): MemoryState {
  if (kind === "practice" && rating !== "again") return before;
  return schedule(before, rating, at);
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
