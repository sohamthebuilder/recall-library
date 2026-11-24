import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** Topics with no Explainer, each with the learner's own prompts, written a second apart (each due as soon as written). */
async function topicsWithPrompts(t: TestCore, spec: Record<string, string[]>) {
  const { created } = await t.core.importTopics(Object.keys(spec).join("\n"));
  const ids: Record<string, string> = {};
  for (const topic of created) {
    for (const question of spec[topic.name]!) {
      t.clock.set(new Date(t.clock.now().getTime() + 1000));
      const p = await t.core.addRecallPrompt({ topicId: topic.id, kind: "explain", question, expectedPoints: [`About ${question}`] });
      ids[question] = p.id;
    }
  }
  return { topics: Object.fromEntries(created.map((c) => [c.name, c.id])), prompts: ids };
}

describe("skipping a prompt in a Review session", () => {
  it("moves on without grading it, and the prompt stays due", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { prompts } = await topicsWithPrompts(t, { Kafka: ["K1", "K2"] });
    const session = (await t.core.startReview())!;
    expect(session.current.question).toBe("K1");

    const after = await t.core.skipPrompt({ sessionId: session.id, promptId: prompts.K1! });

    expect(after).toMatchObject({ current: { question: "K2" }, done: 0, remaining: 1, skipped: 1 });
    expect(await t.core.topicReviews(Object.values((await t.core.dueRecallPrompts()).prompts)[0]!.topicId)).toEqual([]);
    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.question)).toEqual(["K1", "K2"]);
  });
});

describe("undoing the last grade", () => {
  it("removes the Review, restores the prompt's schedule and brings it back as the current prompt", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topics, prompts } = await topicsWithPrompts(t, { Kafka: ["K1", "K2"] });
    const before = await t.core.recallPrompts(topics.Kafka!);
    const session = (await t.core.startReview())!;
    t.clock.set(new Date("2026-03-01T10:30:00Z"));
    const review = await t.core.submitReview({ sessionId: session.id, promptId: prompts.K1!, answer: "Partitions." });
    expect(await t.core.recallPrompts(topics.Kafka!)).not.toEqual(before);

    const after = await t.core.undoReview(review.id);

    expect(after).toMatchObject({ current: { question: "K1" }, done: 0, remaining: 2 });
    expect(await t.core.topicReviews(topics.Kafka!)).toEqual([]);
    expect(await t.core.recallPrompts(topics.Kafka!)).toEqual(before);
  });

  it("is refused once the session has finished", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { prompts } = await topicsWithPrompts(t, { Kafka: ["K1"] });
    const session = (await t.core.startReview())!;
    const review = await t.core.submitReview({ sessionId: session.id, promptId: prompts.K1!, answer: "Partitions." });
    expect(await t.core.reviewSession()).toBeNull();

    await expect(t.core.undoReview(review.id)).rejects.toThrow("That Review session has finished.");
  });
});

describe("the end-of-session summary", () => {
  it("counts what was reviewed and skipped, what comes back soon, and names the weakest Topic", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topics, prompts } = await topicsWithPrompts(t, { Kafka: ["K1", "K2"], Raft: ["R1", "R2"] });
    const grade = (rating: "again" | "hard" | "good" | "easy") => ({ rating, pointsCovered: [], pointsMissed: [], relevantKeyPointIds: [] });
    t.ai.scriptGrade("K1", grade("again"));
    t.ai.scriptGrade("K2", grade("good"));
    t.ai.scriptGrade("R1", grade("good"));
    const session = (await t.core.startReview())!;

    for (const q of ["K1", "R1", "K2"]) {
      await t.core.submitReview({ sessionId: session.id, promptId: prompts[q]!, answer: "An answer." });
    }
    await t.core.skipPrompt({ sessionId: session.id, promptId: prompts.R2! });
    expect(await t.core.reviewSession()).toBeNull();

    expect(await t.core.reviewSummary(session.id)).toEqual({
      kind: "scheduled",
      reviewed: 3,
      skipped: 1,
      ratings: { again: 1, hard: 0, good: 2, easy: 0 },
      comingBackSoon: 1,
      weakestTopic: { id: topics.Kafka, name: "Kafka" },
    });
  });

  it("names no weakest Topic when every answer was Good or Easy", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { prompts } = await topicsWithPrompts(t, { Kafka: ["K1"] });
    const session = (await t.core.startReview())!;
    await t.core.submitReview({ sessionId: session.id, promptId: prompts.K1!, answer: "An answer." });

    expect(await t.core.reviewSummary(session.id)).toMatchObject({ reviewed: 1, weakestTopic: null });
  });
});
