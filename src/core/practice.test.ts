import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError } from "./errors";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/**
 * Topics with no Explainer, each with the learner's own prompts (written a second apart), all answered Good twice on
 * 1 March so FSRS graduates them to 3 March 10:10 (nothing is due on 2 March).
 */
async function topicsReviewedAhead(t: TestCore, spec: Record<string, string[]>) {
  t.clock.set(new Date("2026-03-01T10:00:00Z"));
  const { created } = await t.core.importTopics(Object.keys(spec).join("\n"));
  const prompts: Record<string, string> = {};
  for (const topic of created) {
    for (const question of spec[topic.name]!) {
      t.clock.set(new Date(t.clock.now().getTime() + 1000));
      const p = await t.core.addRecallPrompt({ topicId: topic.id, kind: "explain", question, expectedPoints: [`About ${question}`] });
      prompts[question] = p.id;
    }
  }
  for (const id of Object.values(prompts)) {
    t.clock.set(new Date("2026-03-01T10:00:00Z"));
    await t.core.submitReview({ promptId: id, answer: "An answer." });
    t.clock.set(new Date("2026-03-01T10:10:00Z"));
    await t.core.submitReview({ promptId: id, answer: "An answer." });
  }
  t.clock.set(new Date("2026-03-02T09:00:00Z"));
  return { topics: Object.fromEntries(created.map((c) => [c.name, c.id])), prompts };
}

async function dueOf(t: TestCore, topicId: string, promptId: string) {
  return (await t.core.recallPrompts(topicId)).find((p) => p.id === promptId)!.due;
}

const GRADUATED = new Date("2026-03-03T10:10:00Z");

describe("Practice", () => {
  it("the learner can practise a Topic when nothing is due, and a good grade leaves the schedule alone", async () => {
    const t = await createTestCore();
    const { topics, prompts } = await topicsReviewedAhead(t, { Kafka: ["K1", "K2"], Raft: ["R1"] });
    expect((await t.core.dueRecallPrompts()).prompts).toEqual([]);

    const session = await t.core.startPractice({ topicId: topics.Kafka! });

    expect(session).toMatchObject({ kind: "practice", done: 0, remaining: 2, current: { question: "K1", topicName: "Kafka" } });
    t.ai.scriptGrade("K1", { rating: "good", pointsCovered: ["About K1"], pointsMissed: [], relevantKeyPointIds: [] });
    const review = await t.core.submitReview({ sessionId: session!.id, promptId: prompts.K1!, answer: "Practised." });

    expect(review).toMatchObject({ kind: "practice", rating: "good", sessionId: session!.id });
    expect(await dueOf(t, topics.Kafka!, prompts.K1!)).toEqual(GRADUATED);
    expect(await t.core.practiceSession()).toMatchObject({ id: session!.id, done: 1, remaining: 1, current: { question: "K2" } });
  });

  it("a Practice Review rated Again brings the prompt back sooner", async () => {
    const t = await createTestCore();
    const { topics, prompts } = await topicsReviewedAhead(t, { Kafka: ["K1"] });
    const session = await t.core.startPractice({ topicId: topics.Kafka! });
    t.ai.scriptGrade("K1", { rating: "again", pointsCovered: [], pointsMissed: ["About K1"], relevantKeyPointIds: [] });

    await t.core.submitReview({ sessionId: session!.id, promptId: prompts.K1!, answer: "I forget." });

    // FSRS's default relearning step: 10 minutes after the Review, instead of 3 March.
    expect(await dueOf(t, topics.Kafka!, prompts.K1!)).toEqual(new Date("2026-03-02T09:10:00Z"));
    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.id)).toEqual([prompts.K1]);
  });

  it("Hard and Easy leave the schedule alone too, and overruling the grade follows the same rule", async () => {
    const t = await createTestCore();
    const { topics, prompts } = await topicsReviewedAhead(t, { Kafka: ["K1", "K2"] });
    const session = await t.core.startPractice({ topicId: topics.Kafka! });
    t.ai.scriptGrade("K1", { rating: "hard", pointsCovered: [], pointsMissed: [], relevantKeyPointIds: [] });
    t.ai.scriptGrade("K2", { rating: "easy", pointsCovered: [], pointsMissed: [], relevantKeyPointIds: [] });

    const hard = await t.core.submitReview({ sessionId: session!.id, promptId: prompts.K1!, answer: "Mostly." });
    const easy = await t.core.submitReview({ sessionId: session!.id, promptId: prompts.K2!, answer: "Easily." });
    expect(await dueOf(t, topics.Kafka!, prompts.K1!)).toEqual(GRADUATED);
    expect(await dueOf(t, topics.Kafka!, prompts.K2!)).toEqual(GRADUATED);

    // Overruled to Again: now it counts.
    t.clock.set(new Date("2026-03-02T09:05:00Z"));
    expect(await t.core.overruleGrade({ reviewId: easy.id, rating: "again" })).toMatchObject({ kind: "practice", rating: "again", overruled: true });
    expect(await dueOf(t, topics.Kafka!, prompts.K2!)).toEqual(new Date("2026-03-02T09:10:00Z"));
    // And back to Good: the schedule is as it was before the Practice.
    await t.core.overruleGrade({ reviewId: easy.id, rating: "good" });
    expect(await dueOf(t, topics.Kafka!, prompts.K2!)).toEqual(GRADUATED);
    await t.core.overruleGrade({ reviewId: hard.id, rating: "easy" });
    expect(await dueOf(t, topics.Kafka!, prompts.K1!)).toEqual(GRADUATED);
  });

  it("the learner can practise a Tag: every Topic with it, mixed together", async () => {
    const t = await createTestCore();
    const { topics } = await topicsReviewedAhead(t, { Kafka: ["K1", "K2"], Raft: ["R1"], Paxos: ["P1"] });
    const tag = await t.core.tagTopic({ topicId: topics.Kafka!, name: "Distributed systems" });
    await t.core.tagTopic({ topicId: topics.Raft!, name: "distributed systems" });

    const session = await t.core.startPractice({ tagId: tag.id });

    expect(session).toMatchObject({ kind: "practice", remaining: 3, current: { question: "K1" } });
    const questions = [];
    for (let s = session; s; s = await t.core.practiceSession()) {
      questions.push(s.current.question);
      await t.core.submitReview({ sessionId: s.id, promptId: s.current.id, answer: "An answer." });
    }
    expect(questions).toEqual(["K1", "R1", "K2"]);
  });

  it("Practice Reviews are recorded as Practice, apart from the scheduled Review session", async () => {
    const t = await createTestCore();
    const { topics, prompts } = await topicsReviewedAhead(t, { Kafka: ["K1"], Raft: ["R1"] });
    t.clock.set(new Date("2026-03-03T12:00:00Z"));
    const scheduled = await t.core.startReview();
    const practice = await t.core.startPractice({ topicId: topics.Kafka! });
    expect(practice!.id).not.toBe(scheduled!.id);

    await t.core.submitReview({ sessionId: practice!.id, promptId: prompts.K1!, answer: "Practised." });

    // The scheduled session still has both due prompts to do; the Practice one is finished.
    expect(await t.core.reviewSession()).toMatchObject({ id: scheduled!.id, kind: "scheduled", done: 0, remaining: 2 });
    expect(await t.core.practiceSession()).toBeNull();
    const history = await t.core.topicReviews(topics.Kafka!);
    expect(history.map((r) => [r.answer, r.kind])).toEqual([
      ["Practised.", "practice"],
      ["An answer.", "scheduled"],
      ["An answer.", "scheduled"],
    ]);
  });

  it("starting Practice again replaces the open Practice session; a Topic with no active prompts has none", async () => {
    const t = await createTestCore();
    const { topics, prompts } = await topicsReviewedAhead(t, { Kafka: ["K1"], Raft: ["R1"] });
    await t.core.startPractice({ topicId: topics.Kafka! });

    const raft = await t.core.startPractice({ topicId: topics.Raft! });
    expect(await t.core.practiceSession()).toMatchObject({ id: raft!.id, current: { question: "R1" } });

    await t.core.suspendRecallPrompt(prompts.K1!);
    expect(await t.core.startPractice({ topicId: topics.Kafka! })).toBeNull();
    expect(await t.core.practiceSession()).toBeNull();
    await expect(t.core.startPractice({ topicId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(NotFoundError);
    await expect(t.core.startPractice({ tagId: "nope" })).rejects.toThrow(NotFoundError);
  });
});
