import { type Card, createEmptyCard, fsrs, type Grade, generatorParameters, Rating, State } from "ts-fsrs";
import type { recallPrompts } from "@/db/schema";
import type { ReviewRating } from "./ports/ai";

/**
 * FSRS scheduling, with the default parameters. A Recall Prompt's memory state lives in its
 * recall_prompts row (`due`, `stability`, `difficulty`, `fsrs_state`, `reps`, `lapses`,
 * `learning_steps`, `last_reviewed_at`); this module turns it into a ts-fsrs Card and back.
 */

const scheduler = fsrs(generatorParameters());

/** The memory-state columns of a recall_prompts row. Also what a Review keeps as `card_before`. */
export interface MemoryState {
  due: Date;
  stability: number | null;
  difficulty: number | null;
  fsrsState: (typeof recallPrompts.$inferSelect)["fsrsState"];
  reps: number;
  lapses: number;
  learningSteps: number;
  lastReviewedAt: Date | null;
}

const STATES = ["new", "learning", "review", "relearning"] as const;
const STATE_OF: Record<MemoryState["fsrsState"], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const GRADE_OF: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function memoryStateOf(row: typeof recallPrompts.$inferSelect): MemoryState {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    fsrsState: row.fsrsState,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learningSteps,
    lastReviewedAt: row.lastReviewedAt,
  };
}

/** The memory state after reviewing with this rating at `now`. */
export function schedule(before: MemoryState, rating: ReviewRating, now: Date): MemoryState {
  const next = scheduler.next(toCard(before), now, GRADE_OF[rating]).card;
  return {
    due: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    fsrsState: STATES[next.state],
    reps: next.reps,
    lapses: next.lapses,
    learningSteps: next.learning_steps,
    lastReviewedAt: now,
  };
}

/** FSRS's estimate (0–1) that the learner can recall it at `now`; null before its first Review. */
export function retrievability(state: MemoryState, now: Date): number | null {
  if (!state.lastReviewedAt) return null;
  return scheduler.get_retrievability(toCard(state), now, false);
}

function toCard(before: MemoryState): Card {
  const empty = createEmptyCard(before.due);
  return {
    ...empty,
    due: before.due,
    stability: before.stability ?? empty.stability,
    difficulty: before.difficulty ?? empty.difficulty,
    state: STATE_OF[before.fsrsState],
    reps: before.reps,
    lapses: before.lapses,
    learning_steps: before.learningSteps,
    last_review: before.lastReviewedAt ?? undefined,
  };
}

/** For storing as jsonb (a Review's `card_before`). */
export function serializeMemoryState(s: MemoryState) {
  return { ...s, due: s.due.toISOString(), lastReviewedAt: s.lastReviewedAt?.toISOString() ?? null };
}

export function parseMemoryState(json: unknown): MemoryState {
  const s = json as ReturnType<typeof serializeMemoryState>;
  return { ...s, due: new Date(s.due), lastReviewedAt: s.lastReviewedAt ? new Date(s.lastReviewedAt) : null };
}
