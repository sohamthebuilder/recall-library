import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** A Topic with one processed Note linked to it, its Explainer and Recall Prompts generated. */
async function topicWithExplainer(t: TestCore, topicName = "Kafka consumer groups") {
  const text = `Notes about ${topicName}.`;
  t.ai.scriptTopicProposals(text, [{ name: topicName, description: null }]);
  const note = await t.core.addSource({ kind: "note", title: topicName, text });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  return topic;
}

describe("generating Recall Prompts", () => {
  it("generating an Explainer generates Recall Prompts of all four kinds from it, each with expected key points", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    t.ai.scriptRecallPrompts("Kafka consumer groups", ({ explainer }) => [
      { kind: "explain", question: "Explain how a consumer group shares work.", expectedPoints: [explainer.keyPoints[0]!.text] },
      { kind: "compare", question: "Compare a consumer group with a queue.", expectedPoints: ["Each partition has one consumer"] },
      { kind: "apply", question: "You add a fifth consumer to four partitions. What happens?", expectedPoints: ["It sits idle"] },
      { kind: "why", question: "Why can't two consumers in a group read one partition?", expectedPoints: ["Ordering", "Offsets"] },
    ]);

    const topic = await topicWithExplainer(t);

    const explainer = await t.core.explainer(topic.id);
    expect(t.ai.recallPromptRequests).toEqual([
      { topic: { name: "Kafka consumer groups", description: null }, explainer: explainer!.current!.content },
    ]);
    const prompts = await t.core.recallPrompts(topic.id);
    expect(prompts).toMatchObject([
      {
        topicId: topic.id,
        kind: "explain",
        question: "Explain how a consumer group shares work.",
        expectedPoints: [explainer!.current!.content.keyPoints[0]!.text],
        origin: "generated",
        state: "active",
        createdAt: new Date("2026-03-01T10:00:00Z"),
      },
      { kind: "compare", expectedPoints: ["Each partition has one consumer"], origin: "generated", state: "active" },
      { kind: "apply", expectedPoints: ["It sits idle"], origin: "generated", state: "active" },
      { kind: "why", expectedPoints: ["Ordering", "Offsets"], origin: "generated", state: "active" },
    ]);
  });
});

describe("when generation does not work", () => {
  it("an AI failure or prompts missing a kind leave the Topic with no prompts, and the learner can generate them again", async () => {
    const t = await createTestCore();
    t.ai.scriptRecallPromptsFailure("Kafka consumer groups", "The AI service is busy.");
    const topic = await topicWithExplainer(t);
    expect(await t.core.recallPrompts(topic.id)).toEqual([]);

    t.ai.scriptRecallPrompts("Kafka consumer groups", [
      { kind: "explain", question: "Explain it.", expectedPoints: ["A point"] },
      { kind: "why", question: "Why?", expectedPoints: [] },
    ]);
    await t.core.generateRecallPrompts(topic.id);
    await t.core.runJobs();
    expect(await t.core.recallPrompts(topic.id)).toEqual([]);

    t.ai.scriptRecallPrompts("Kafka consumer groups", [
      { kind: "explain", question: "Explain it.", expectedPoints: ["A point"] },
      { kind: "compare", question: "Compare it.", expectedPoints: ["A point"] },
      { kind: "apply", question: "Apply it.", expectedPoints: ["A point"] },
      { kind: "why", question: "Why?", expectedPoints: ["A reason"] },
      { kind: "trivia", question: "What year?", expectedPoints: ["1999"] },
    ]);
    await t.core.generateRecallPrompts(topic.id);
    await t.core.runJobs();
    expect((await t.core.recallPrompts(topic.id)).map((p) => p.kind)).toEqual(["explain", "compare", "apply", "why"]);
  });

  it("generating again is refused once the Topic has its prompts, or before it has an Explainer", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    await expect(t.core.generateRecallPrompts(topic.id)).rejects.toThrow(ValidationError);

    const { created } = await t.core.importTopics("Raft elections");
    await expect(t.core.generateRecallPrompts(created[0]!.id)).rejects.toThrow(ValidationError);
  });
});

describe("the learner's own changes", () => {
  it("editing a generated prompt changes its wording and makes it learner_edited, keeping its schedule", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const topic = await topicWithExplainer(t);
    const [prompt] = await t.core.recallPrompts(topic.id);

    t.clock.set(new Date("2026-03-02T09:00:00Z"));
    const edited = await t.core.editRecallPrompt({
      promptId: prompt!.id,
      kind: "why",
      question: "  Why does a group split partitions?  ",
      expectedPoints: ["Parallelism", "  ", " Ordering per partition "],
    });

    expect(edited).toMatchObject({
      id: prompt!.id,
      kind: "why",
      question: "Why does a group split partitions?",
      expectedPoints: ["Parallelism", "Ordering per partition"],
      origin: "learner_edited",
      state: "active",
      updatedAt: new Date("2026-03-02T09:00:00Z"),
      due: prompt!.due,
    });
    expect((await t.core.recallPrompts(topic.id)).find((p) => p.id === prompt!.id)).toEqual(edited);
  });

  it("an edit needs a question and at least one expected point", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const [prompt] = await t.core.recallPrompts(topic.id);

    await expect(
      t.core.editRecallPrompt({ promptId: prompt!.id, kind: "explain", question: " ", expectedPoints: ["x"] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      t.core.editRecallPrompt({ promptId: prompt!.id, kind: "explain", question: "Q?", expectedPoints: [" "] }),
    ).rejects.toThrow(ValidationError);
    expect((await t.core.recallPrompts(topic.id))[0]).toEqual(prompt);
  });

  it("the learner can write their own prompt, which is active and due straight away", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const topic = await topicWithExplainer(t);

    t.clock.set(new Date("2026-03-03T08:00:00Z"));
    const written = await t.core.addRecallPrompt({
      topicId: topic.id,
      kind: "apply",
      question: "How would you scale a slow consumer?",
      expectedPoints: ["Add partitions", "Add consumers up to the partition count"],
    });

    expect(written).toMatchObject({
      topicId: topic.id,
      kind: "apply",
      origin: "learner_written",
      state: "active",
      createdAt: new Date("2026-03-03T08:00:00Z"),
      due: new Date("2026-03-03T08:00:00Z"),
    });
    const prompts = await t.core.recallPrompts(topic.id);
    expect(prompts).toHaveLength(5);
    expect(prompts).toContainEqual(written);

    const edited = await t.core.editRecallPrompt({
      promptId: written.id,
      kind: "apply",
      question: "How would you scale a slow consumer group?",
      expectedPoints: ["Add partitions"],
    });
    expect(edited.origin).toBe("learner_written");
  });

  it("writing a prompt for a Topic that does not exist is refused", async () => {
    const t = await createTestCore();
    await expect(
      t.core.addRecallPrompt({
        topicId: "00000000-0000-0000-0000-000000000000",
        kind: "why",
        question: "Why?",
        expectedPoints: ["Because"],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("the learner can pause a prompt and resume it", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const [prompt] = await t.core.recallPrompts(topic.id);

    expect(await t.core.suspendRecallPrompt(prompt!.id)).toMatchObject({ id: prompt!.id, state: "suspended" });
    expect((await t.core.recallPrompts(topic.id))[0]!.state).toBe("suspended");
    await expect(t.core.suspendRecallPrompt(prompt!.id)).rejects.toThrow(ValidationError);

    expect(await t.core.resumeRecallPrompt(prompt!.id)).toMatchObject({ id: prompt!.id, state: "active" });
    expect((await t.core.recallPrompts(topic.id))[0]!.state).toBe("active");
    await expect(t.core.resumeRecallPrompt(prompt!.id)).rejects.toThrow(ValidationError);
  });

  it("deleting a prompt removes it from the Topic, and it can no longer be changed", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const [prompt, ...others] = await t.core.recallPrompts(topic.id);

    await t.core.deleteRecallPrompt(prompt!.id);

    expect(await t.core.recallPrompts(topic.id)).toEqual(others);
    await expect(t.core.suspendRecallPrompt(prompt!.id)).rejects.toThrow(NotFoundError);
    await expect(
      t.core.editRecallPrompt({ promptId: prompt!.id, kind: "why", question: "Q?", expectedPoints: ["x"] }),
    ).rejects.toThrow(NotFoundError);
    await expect(t.core.deleteRecallPrompt(prompt!.id)).rejects.toThrow(NotFoundError);
  });

  it("deleting every generated prompt does not bring them back", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    for (const p of await t.core.recallPrompts(topic.id)) await t.core.deleteRecallPrompt(p.id);

    await expect(t.core.generateRecallPrompts(topic.id)).rejects.toThrow(ValidationError);
    expect(await t.core.recallPrompts(topic.id)).toEqual([]);
  });
});
