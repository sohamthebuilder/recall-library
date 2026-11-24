import { and, eq, isNull } from "drizzle-orm";
import { recallPrompts } from "@/db/schema";
import type { CoreDeps } from "./core";
import { type DueOptions, endOfDay } from "./reviews";
import { memoryStateOf, retrievability } from "./scheduling";

/** How well a Topic is remembered, from its active Recall Prompts. */
export interface TopicMemory {
  /** Prompts due by the end of today. */
  dueCount: number;
  /** When the next prompt is due (possibly already past). */
  nextDue: Date;
  /** The latest Review of any of its prompts; null if never reviewed. */
  lastReviewedAt: Date | null;
  /** Average FSRS recall probability (0–1) of its reviewed prompts now; null if none reviewed. */
  strength: number | null;
}

/** Each Topic with active Recall Prompts, by id: due, last reviewed and strength (for sorting the Topics list). */
export async function topicMemory(deps: CoreDeps, options: DueOptions = {}): Promise<Record<string, TopicMemory>> {
  const now = deps.clock.now();
  const cutoff = endOfDay(now, options.timeZone ?? "UTC");
  const rows = await deps.db
    .select()
    .from(recallPrompts)
    .where(and(eq(recallPrompts.state, "active"), isNull(recallPrompts.deletedAt)));

  const out: Record<string, TopicMemory & { strengths: number[] }> = {};
  for (const row of rows) {
    const state = memoryStateOf(row);
    const m = (out[row.topicId] ??= { dueCount: 0, nextDue: state.due, lastReviewedAt: null, strength: null, strengths: [] });
    if (state.due < cutoff) m.dueCount++;
    if (state.due < m.nextDue) m.nextDue = state.due;
    if (state.lastReviewedAt && (!m.lastReviewedAt || state.lastReviewedAt > m.lastReviewedAt)) {
      m.lastReviewedAt = state.lastReviewedAt;
    }
    const r = retrievability(state, now);
    if (r !== null) m.strengths.push(r);
  }
  return Object.fromEntries(
    Object.entries(out).map(([topicId, { strengths, ...m }]) => [
      topicId,
      { ...m, strength: strengths.length ? strengths.reduce((a, b) => a + b, 0) / strengths.length : null },
    ]),
  );
}
