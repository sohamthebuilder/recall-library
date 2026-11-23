import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";
import { AiError } from "./ports/ai";

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

describe("the due queue", () => {
  it("has every active prompt due today or earlier, mixed across Topics, with a rough duration", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    await topicsWithPrompts(t, { Kafka: ["K1", "K2", "K3"], Raft: ["R1", "R2"] });
    t.clock.set(new Date("2026-03-01T10:05:00Z"));
    await topicsWithPrompts(t, { Paxos: ["P1"] });

    const due = await t.core.dueRecallPrompts();

    expect(due.prompts.map((p) => p.question)).toEqual(["K1", "R1", "P1", "K2", "R2", "K3"]);
    expect(due.prompts[0]).toMatchObject({ question: "K1", topicName: "Kafka" });
    expect(due.estimatedMinutes).toBe(12);
  });

  it("leaves out paused and deleted prompts and those not due yet", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { prompts } = await topicsWithPrompts(t, { Kafka: ["K1", "K2", "K3", "K4"] });
    await t.core.suspendRecallPrompt(prompts.K1!);
    await t.core.deleteRecallPrompt(prompts.K2!);

    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.question)).toEqual(["K3", "K4"]);

    t.clock.set(new Date("2026-02-28T10:00:00Z"));
    expect((await t.core.dueRecallPrompts()).prompts).toEqual([]);
  });
});

/** A Topic with one processed Note linked to it, its Explainer and its four generated prompts. */
async function topicWithExplainer(t: TestCore, topicName = "Kafka consumer groups") {
  const text = `Notes about ${topicName}.`;
  t.ai.scriptTopicProposals(text, [{ name: topicName, description: null }]);
  const note = await t.core.addSource({ kind: "note", title: topicName, text });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  const prompts = await t.core.recallPrompts(topic.id);
  return { topic, prompts, explain: prompts.find((p) => p.kind === "explain")! };
}

describe("a scheduled Review", () => {
  it("grades a typed answer against the expected points and the Explainer, and shows the relevant part of it", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topic, explain } = await topicWithExplainer(t);
    const explainer = (await t.core.explainer(topic.id))!.current!.content;
    t.ai.scriptGrade(explain.question, {
      rating: "hard",
      pointsCovered: ["Partitions are shared out"],
      pointsMissed: ["One consumer per partition"],
      relevantKeyPointIds: ["kp1"],
    });

    const review = await t.core.submitReview({ promptId: explain.id, answer: "  The group splits the partitions.  " });

    expect(t.ai.gradeRequests).toEqual([
      {
        topic: { name: "Kafka consumer groups", description: null },
        question: explain.question,
        expectedPoints: explain.expectedPoints,
        answer: "The group splits the partitions.",
        explainer,
      },
    ]);
    expect(review).toMatchObject({
      promptId: explain.id,
      topicId: topic.id,
      kind: "scheduled",
      question: explain.question,
      answer: "The group splits the partitions.",
      aiRating: "hard",
      rating: "hard",
      overruled: false,
      pointsCovered: ["Partitions are shared out"],
      pointsMissed: ["One consumer per partition"],
      explainerKeyPoints: [explainer.keyPoints[0]],
      reviewedAt: new Date("2026-03-01T10:00:00Z"),
    });
  });

  it("updates the prompt's FSRS schedule with the rating", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { explain } = await topicWithExplainer(t);

    // FSRS's default learning steps are 1m and 10m: Good on a new prompt brings it back in 10 minutes.
    await t.core.submitReview({ promptId: explain.id, answer: "An answer." });
    let due = await t.core.dueRecallPrompts();
    expect(due.prompts.find((p) => p.id === explain.id)?.due).toEqual(new Date("2026-03-01T10:10:00Z"));

    // Good again after the last step graduates it to days away.
    t.clock.set(new Date("2026-03-01T10:10:00Z"));
    await t.core.submitReview({ promptId: explain.id, answer: "An answer." });
    due = await t.core.dueRecallPrompts();
    expect(due.prompts.map((p) => p.id)).not.toContain(explain.id);
    expect((await t.core.recallPrompts(explain.topicId)).find((p) => p.id === explain.id)!.due).toEqual(
      new Date("2026-03-03T10:10:00Z"),
    );

    // "Today" ends at the learner's midnight.
    t.clock.set(new Date("2026-03-02T20:00:00Z"));
    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.id)).not.toContain(explain.id);
    expect((await t.core.dueRecallPrompts({ timeZone: "Asia/Kolkata" })).prompts.map((p) => p.id)).toContain(explain.id);
  });

  it("refuses a blank answer and a paused or deleted prompt, and changes nothing when grading fails", async () => {
    const t = await createTestCore();
    const { topic, prompts, explain } = await topicWithExplainer(t);
    const [, paused, deleted] = prompts.filter((p) => p.id !== explain.id);

    await expect(t.core.submitReview({ promptId: explain.id, answer: "   " })).rejects.toThrow(ValidationError);
    await t.core.suspendRecallPrompt(paused!.id);
    await expect(t.core.submitReview({ promptId: paused!.id, answer: "A" })).rejects.toThrow(ValidationError);
    await t.core.deleteRecallPrompt(deleted!.id);
    await expect(t.core.submitReview({ promptId: deleted!.id, answer: "A" })).rejects.toThrow(NotFoundError);

    t.ai.scriptGradeFailure(explain.question, "The AI service is busy.");
    await expect(t.core.submitReview({ promptId: explain.id, answer: "A" })).rejects.toThrow(AiError);
    t.ai.scriptGrade(explain.question, { rating: "superb", pointsCovered: [], pointsMissed: [], relevantKeyPointIds: [] });
    await expect(t.core.submitReview({ promptId: explain.id, answer: "A" })).rejects.toThrow(AiError);

    expect((await t.core.recallPrompts(topic.id)).find((p) => p.id === explain.id)).toEqual(explain);
  });
});

describe("overruling the grade", () => {
  it("the learner's rating replaces the AI's and decides when the prompt comes back", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { explain } = await topicWithExplainer(t);
    t.ai.scriptGrade(explain.question, { rating: "easy", pointsCovered: ["All of it"], pointsMissed: [], relevantKeyPointIds: [] });
    const review = await t.core.submitReview({ promptId: explain.id, answer: "I guessed." });
    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.id)).not.toContain(explain.id);

    t.clock.set(new Date("2026-03-01T10:00:30Z"));
    const overruled = await t.core.overruleGrade({ reviewId: review.id, rating: "again" });

    expect(overruled).toMatchObject({ id: review.id, aiRating: "easy", rating: "again", overruled: true });
    // Again on a new prompt: FSRS's first learning step, 1 minute after the Review.
    const due = await t.core.dueRecallPrompts();
    expect(due.prompts.find((p) => p.id === explain.id)?.due).toEqual(new Date("2026-03-01T10:01:00Z"));
  });

  it("only the prompt's latest Review can be overruled", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { explain } = await topicWithExplainer(t);
    const first = await t.core.submitReview({ promptId: explain.id, answer: "One." });
    t.clock.set(new Date("2026-03-01T10:10:00Z"));
    await t.core.submitReview({ promptId: explain.id, answer: "Two." });

    await expect(t.core.overruleGrade({ reviewId: first.id, rating: "again" })).rejects.toThrow(ValidationError);
  });
});

describe("a Review session", () => {
  it("works through the due queue, and an interrupted session resumes where it left off", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    await topicsWithPrompts(t, { Kafka: ["K1", "K2"], Raft: ["R1"] });

    const started = await t.core.startReview();
    expect(started).toMatchObject({ done: 0, remaining: 3, current: { question: "K1", topicName: "Kafka" } });
    await t.core.submitReview({ sessionId: started!.id, promptId: started!.current!.id, answer: "An answer." });

    // Interrupted: the learner comes back later and starts again.
    t.clock.set(new Date("2026-03-01T18:00:00Z"));
    const resumed = await t.core.startReview();
    expect(resumed).toMatchObject({ id: started!.id, done: 1, remaining: 2, current: { question: "R1" } });
    expect(resumed!.lastReview).toMatchObject({ question: "K1", answer: "An answer." });
    expect(await t.core.reviewSession()).toEqual(resumed);

    await t.core.submitReview({ sessionId: started!.id, promptId: resumed!.current!.id, answer: "An answer." });
    const last = await t.core.reviewSession();
    expect(last).toMatchObject({ done: 2, remaining: 1, current: { question: "K2" } });
    await t.core.submitReview({ sessionId: started!.id, promptId: last!.current!.id, answer: "An answer." });

    expect(await t.core.reviewSession()).toBeNull();
  });

  it("there is no session to start when nothing is due", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    await topicsWithPrompts(t, { Kafka: ["K1"] });
    t.clock.set(new Date("2026-02-01T10:00:00Z"));

    expect(await t.core.startReview()).toBeNull();
    expect(await t.core.reviewSession()).toBeNull();
  });

  it("the learner can edit, pause or delete the current prompt mid-Review", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    await topicsWithPrompts(t, { Kafka: ["K1", "K2"], Raft: ["R1", "R2"] });
    const session = await t.core.startReview();
    expect(session!.current!.question).toBe("K1");

    await t.core.editRecallPrompt({ promptId: session!.current!.id, kind: "why", question: "Why K1?", expectedPoints: ["Because"] });
    expect((await t.core.reviewSession())!.current).toMatchObject({ question: "Why K1?", kind: "why" });

    await t.core.suspendRecallPrompt(session!.current!.id);
    expect((await t.core.reviewSession())!).toMatchObject({ remaining: 3, current: { question: "R1" } });

    await t.core.deleteRecallPrompt((await t.core.reviewSession())!.current!.id);
    expect((await t.core.reviewSession())!).toMatchObject({ done: 0, remaining: 2, current: { question: "K2" } });
  });
});

describe("a Topic's Review history", () => {
  it("lists its Reviews newest first, keeping those of deleted prompts as they were asked", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topics, prompts } = await topicsWithPrompts(t, { Kafka: ["K1", "K2"], Raft: ["R1"] });
    t.ai.scriptGrade("K1", { rating: "again", pointsCovered: [], pointsMissed: ["About K1"], relevantKeyPointIds: [] });
    await t.core.submitReview({ promptId: prompts.K1!, answer: "No idea." });
    t.clock.set(new Date("2026-03-01T11:00:00Z"));
    await t.core.submitReview({ promptId: prompts.K2!, answer: "Something." });
    await t.core.submitReview({ promptId: prompts.R1!, answer: "Elsewhere." });
    await t.core.editRecallPrompt({ promptId: prompts.K1!, kind: "why", question: "Why K1?", expectedPoints: ["x"] });
    await t.core.deleteRecallPrompt(prompts.K1!);

    const history = await t.core.topicReviews(topics.Kafka!);

    expect(history).toMatchObject([
      { promptId: prompts.K2, question: "K2", answer: "Something.", rating: "good", reviewedAt: new Date("2026-03-01T11:00:00Z") },
      { promptId: prompts.K1, question: "K1", answer: "No idea.", rating: "again", pointsMissed: ["About K1"] },
    ]);
  });

  it("goes with the Topic when the Topic is deleted", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topics, prompts } = await topicsWithPrompts(t, { Kafka: ["K1"] });
    const review = await t.core.submitReview({ promptId: prompts.K1!, answer: "An answer." });

    await t.core.deleteTopic(topics.Kafka!);

    await expect(t.core.topicReviews(topics.Kafka!)).rejects.toThrow(NotFoundError);
    await expect(t.core.overruleGrade({ reviewId: review.id, rating: "again" })).rejects.toThrow(NotFoundError);
  });
});
