import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

async function topicWithPrompts(t: TestCore, name: string, questions: string[]) {
  const { created } = await t.core.importTopics(name);
  const topic = created[0]!;
  const prompts = [];
  for (const question of questions) {
    t.clock.set(new Date(t.clock.now().getTime() + 1000));
    prompts.push(await t.core.addRecallPrompt({ topicId: topic.id, kind: "explain", question, expectedPoints: ["A point"] }));
  }
  return { topic, prompts };
}

describe("how well each Topic is remembered", () => {
  it("a Topic never reviewed has its prompts due, no last Review and no strength yet", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topic, prompts } = await topicWithPrompts(t, "Kafka", ["K1", "K2"]);

    expect((await t.core.topicMemory())[topic.id]).toEqual({
      dueCount: 2,
      nextDue: prompts[0]!.due,
      lastReviewedAt: null,
      strength: null,
    });
  });

  it("after a Review it shows when, and a strength that fades with time", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topic, prompts } = await topicWithPrompts(t, "Kafka", ["K1"]);
    t.ai.scriptGrade("K1", { rating: "easy", pointsCovered: [], pointsMissed: [], relevantKeyPointIds: [] });
    const reviewedAt = new Date("2026-03-01T11:00:00Z");
    t.clock.set(reviewedAt);
    await t.core.submitReview({ promptId: prompts[0]!.id, answer: "An answer." });

    const right = (await t.core.topicMemory())[topic.id]!;
    expect(right).toMatchObject({ dueCount: 0, lastReviewedAt: reviewedAt });
    expect(right.strength).toBeGreaterThan(0.95);

    t.clock.set(new Date("2026-04-15T11:00:00Z"));
    const later = (await t.core.topicMemory())[topic.id]!;
    expect(later.dueCount).toBe(1);
    expect(later.strength).toBeLessThan(right.strength!);
  });

  it("leaves out Topics with no Recall Prompts", async () => {
    const t = await createTestCore();
    await t.core.importTopics("Raft");

    expect(await t.core.topicMemory()).toEqual({});
  });
});

describe("Sources in the Library", () => {
  it("say how many Topics draw on them", async () => {
    const t = await createTestCore();
    t.ai.scriptTopicProposals("Partitions and offsets.", [
      { name: "Partitions", description: null },
      { name: "Offsets", description: null },
    ]);
    const note = await t.core.addSource({ kind: "note", text: "Partitions and offsets." });
    await t.core.runJobs();
    const [a, b] = await t.core.topicProposals(note.id);
    await t.core.approveTopic({ proposalId: a!.id });
    await t.core.approveTopic({ proposalId: b!.id });

    expect((await t.core.library()).sources[0]).toMatchObject({ id: note.id, topicCount: 2 });
  });
});
