import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

const TOPIC = "Kafka consumer groups";

/** A Topic whose Explainer has been generated, with these four generated Recall Prompts. */
async function topicWithPrompts(t: TestCore) {
  const text = `Notes about ${TOPIC}.`;
  t.ai.scriptTopicProposals(text, [{ name: TOPIC, description: null }]);
  t.ai.scriptRecallPrompts(TOPIC, [
    { kind: "explain", question: "Explain how a group shares partitions.", expectedPoints: ["One consumer per partition"] },
    { kind: "compare", question: "Compare a group with a queue.", expectedPoints: ["Ordering per partition"] },
    { kind: "apply", question: "Five consumers, four partitions: what happens?", expectedPoints: ["One sits idle"] },
    { kind: "why", question: "Why are offsets kept per group?", expectedPoints: ["Groups read independently"] },
  ]);
  const note = await t.core.addSource({ kind: "note", title: "Kafka notes", text });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  const prompts = await t.core.recallPrompts(topic.id);
  const byKind = Object.fromEntries(prompts.map((p) => [p.kind, p]));
  return { topic, prompts: byKind as Record<"explain" | "compare" | "apply" | "why", (typeof prompts)[number]> };
}

describe("reconciling Recall Prompts when the Explainer changes", () => {
  it("prompts that still fit are kept with their schedule, ones that no longer fit are retired, and new ones are added", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topic, prompts } = await topicWithPrompts(t);
    t.ai.scriptRecallPromptReconciliation(TOPIC, ({ prompts: judged }) => ({
      keep: judged.filter((p) => p.kind !== "compare").map((p) => p.id),
      add: [{ kind: "compare", question: "Compare a consumer group with a broadcast.", expectedPoints: ["Each message goes to one member"] }],
    }));
    t.clock.set(new Date("2026-03-05T09:00:00Z"));

    await t.core.editExplainerText({ topicId: topic.id, title: "Consumer groups, in my words" });
    await t.core.runJobs();

    const after = await t.core.recallPrompts(topic.id);
    expect(after.find((p) => p.id === prompts.explain.id)).toEqual(prompts.explain);
    expect(after.find((p) => p.id === prompts.apply.id)).toEqual(prompts.apply);
    expect(after.find((p) => p.id === prompts.why.id)).toEqual(prompts.why);
    expect(after.find((p) => p.id === prompts.compare.id)).toEqual({
      ...prompts.compare,
      state: "retired",
      updatedAt: new Date("2026-03-05T09:00:00Z"),
    });
    const added = after.filter((p) => !Object.values(prompts).some((old) => old.id === p.id));
    expect(added).toMatchObject([
      {
        kind: "compare",
        question: "Compare a consumer group with a broadcast.",
        expectedPoints: ["Each message goes to one member"],
        origin: "generated",
        state: "active",
        createdAt: new Date("2026-03-05T09:00:00Z"),
        due: new Date("2026-03-05T09:00:00Z"),
      },
    ]);
  });

  it("the AI judges the generated prompts against the new current version", async () => {
    const t = await createTestCore();
    const { topic, prompts } = await topicWithPrompts(t);

    await t.core.editExplainerText({ topicId: topic.id, title: "Consumer groups, in my words" });
    await t.core.runJobs();

    const current = (await t.core.explainer(topic.id))!.current!;
    expect(t.ai.reconciliationRequests).toEqual([
      {
        topic: { name: TOPIC, description: null },
        explainer: current.content,
        prompts: (["explain", "compare", "apply", "why"] as const).map((k) => ({
          id: prompts[k].id,
          kind: k,
          question: prompts[k].question,
          expectedPoints: prompts[k].expectedPoints,
        })),
        learnerPrompts: [],
      },
    ]);
  });
});

describe("what reconciliation never touches", () => {
  it("learner_edited and learner_written prompts are never changed, even when the AI keeps nothing", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { topic, prompts } = await topicWithPrompts(t);
    const edited = await t.core.editRecallPrompt({
      promptId: prompts.why.id,
      kind: "why",
      question: "Why does each group keep its own offsets?",
      expectedPoints: ["Groups read independently"],
    });
    const written = await t.core.addRecallPrompt({
      topicId: topic.id,
      kind: "apply",
      question: "How would you scale a slow consumer?",
      expectedPoints: ["Add partitions"],
    });
    t.ai.scriptRecallPromptReconciliation(TOPIC, { keep: [], add: [] });

    await t.core.editExplainerText({ topicId: topic.id, title: "Rewritten" });
    await t.core.runJobs();

    const after = await t.core.recallPrompts(topic.id);
    expect(after.find((p) => p.id === edited.id)).toEqual(edited);
    expect(after.find((p) => p.id === written.id)).toEqual(written);
    expect(after.filter((p) => p.state === "retired").map((p) => p.id).sort()).toEqual(
      [prompts.explain.id, prompts.compare.id, prompts.apply.id].sort(),
    );
    // They are not judged, only shown so new prompts do not repeat them.
    const [request] = t.ai.reconciliationRequests;
    expect(request!.prompts.map((p) => p.id)).not.toContain(edited.id);
    expect(request!.learnerPrompts).toEqual(
      expect.arrayContaining([
        { kind: "why", question: "Why does each group keep its own offsets?", expectedPoints: ["Groups read independently"] },
        { kind: "apply", question: "How would you scale a slow consumer?", expectedPoints: ["Add partitions"] },
      ]),
    );
  });

  it("a paused prompt that still fits stays paused; retired and deleted prompts are left alone", async () => {
    const t = await createTestCore();
    const { topic, prompts } = await topicWithPrompts(t);
    await t.core.suspendRecallPrompt(prompts.explain.id);
    await t.core.deleteRecallPrompt(prompts.compare.id);
    t.ai.scriptRecallPromptReconciliation(TOPIC, ({ prompts: judged }) => ({
      keep: judged.filter((p) => p.kind !== "apply").map((p) => p.id),
      add: [],
    }));
    await t.core.editExplainerText({ topicId: topic.id, title: "First rewrite" });
    await t.core.runJobs();
    expect(t.ai.reconciliationRequests[0]!.prompts.map((p) => p.kind).sort()).toEqual(["apply", "explain", "why"]);
    expect((await t.core.recallPrompts(topic.id)).map((p) => [p.kind, p.state])).toEqual([
      ["explain", "suspended"],
      ["apply", "retired"],
      ["why", "active"],
    ]);

    t.ai.scriptRecallPromptReconciliation(TOPIC, { keep: [], add: [] });
    await t.core.editExplainerText({ topicId: topic.id, title: "Second rewrite" });
    await t.core.runJobs();

    // The second time, the already-retired prompt is not judged again.
    expect(t.ai.reconciliationRequests[1]!.prompts.map((p) => p.kind).sort()).toEqual(["explain", "why"]);
    expect((await t.core.recallPrompts(topic.id)).map((p) => [p.kind, p.state])).toEqual([
      ["explain", "retired"],
      ["apply", "retired"],
      ["why", "retired"],
    ]);
  });
});

describe("when reconciliation runs", () => {
  it("restoring a version and switching form also reconcile the prompts with the new current version", async () => {
    const t = await createTestCore();
    const { topic } = await topicWithPrompts(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    await t.core.editExplainerText({ topicId: topic.id, title: "Rewritten" });
    await t.core.runJobs();

    await t.core.restoreExplainerVersion({ topicId: topic.id, versionId: v1.id });
    await t.core.runJobs();
    await t.core.switchExplainerForm({ topicId: topic.id, form: "animation" });
    await t.core.runJobs();

    expect(t.ai.reconciliationRequests.map((r) => [r.explainer.title, r.explainer.form])).toEqual([
      ["Rewritten", "infographic"],
      [v1.content.title, "infographic"],
      [v1.content.title, "animation"],
    ]);
  });

  it("several quick changes reconcile once, against the latest version", async () => {
    const t = await createTestCore();
    const { topic } = await topicWithPrompts(t);

    await t.core.editExplainerText({ topicId: topic.id, title: "First" });
    await t.core.editExplainerText({ topicId: topic.id, title: "Second" });
    await t.core.runJobs();

    expect(t.ai.reconciliationRequests.map((r) => r.explainer.title)).toEqual(["Second"]);
  });

  it("if the AI fails, every prompt is left as it was, and the next change reconciles again", async () => {
    const t = await createTestCore();
    const { topic } = await topicWithPrompts(t);
    const before = await t.core.recallPrompts(topic.id);
    t.ai.scriptRecallPromptReconciliationFailure(TOPIC, "The AI service is busy.");

    await t.core.editExplainerText({ topicId: topic.id, title: "Rewritten" });
    await t.core.runJobs();
    expect(await t.core.recallPrompts(topic.id)).toEqual(before);

    t.ai.scriptRecallPromptReconciliation(TOPIC, { keep: [], add: [] });
    await t.core.editExplainerText({ topicId: topic.id, title: "Rewritten again" });
    await t.core.runJobs();
    expect((await t.core.recallPrompts(topic.id)).every((p) => p.state === "retired")).toBe(true);
  });

  it("unknown ids the AI asks to keep are ignored, and malformed new prompts are dropped", async () => {
    const t = await createTestCore();
    const { topic, prompts } = await topicWithPrompts(t);
    t.ai.scriptRecallPromptReconciliation(TOPIC, {
      keep: [prompts.explain.id, "not-a-prompt"],
      add: [
        { kind: "why", question: "  Why commit after processing? ", expectedPoints: ["At-least-once", " "] },
        { kind: "trivia", question: "What year?", expectedPoints: ["2011"] },
        { kind: "apply", question: " ", expectedPoints: ["x"] },
      ],
    });

    await t.core.editExplainerText({ topicId: topic.id, title: "Rewritten" });
    await t.core.runJobs();

    const after = await t.core.recallPrompts(topic.id);
    expect(after.filter((p) => p.state === "active").map((p) => [p.kind, p.question, p.expectedPoints])).toEqual([
      ["explain", prompts.explain.question, prompts.explain.expectedPoints],
      ["why", "Why commit after processing?", ["At-least-once"]],
    ]);
  });
});
