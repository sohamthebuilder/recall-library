import { describe, expect, it } from "vitest";
import type { GenerateExplainerInput } from "./ports/ai";
import { createTestCore } from "../../test/harness";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** A process-shaped draft: the AI chose an animation that walks through it step by step. */
function processDraft({ passages }: GenerateExplainerInput) {
  return {
    form: "animation",
    title: "How a message is consumed",
    keyPoints: [{ id: "kp1", text: "A consumer polls, processes, then commits.", citations: [{ chunkId: passages[0]!.chunkId }] }],
    analogy: null,
    diagram: {
      groups: [],
      nodes: [
        { id: "poll", label: "Poll", groupId: null },
        { id: "process", label: "Process", groupId: null },
        { id: "commit", label: "Commit offset", groupId: null },
      ],
      edges: [
        { id: "e1", from: "poll", to: "process", label: null },
        { id: "e2", from: "process", to: "commit", label: null },
      ],
    },
    steps: [
      { caption: "The consumer polls for a batch.", highlight: { nodeIds: ["poll"], edgeIds: [] } },
      { caption: "It processes each message.", highlight: { nodeIds: ["process"], edgeIds: ["e1"] } },
      { caption: "Then it commits the offset.", highlight: { nodeIds: ["commit"], edgeIds: ["e2"] } },
    ],
  };
}

/** A Topic with a ready Explainer, generated from one Note. */
async function topicWithExplainer(t: TestCore, topicName = "Consuming messages") {
  const text = "A consumer polls a batch, processes it, then commits its offset.";
  t.ai.scriptTopicProposals(text, [{ name: topicName, description: null }]);
  const note = await t.core.addSource({ kind: "note", title: "Notes", text });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  return topic;
}

describe("the AI picks the Explainer's form", () => {
  it("a process is generated as an animation whose steps highlight parts of the diagram, each with a caption", async () => {
    const t = await createTestCore();
    t.ai.scriptExplainer("Consuming messages", processDraft);

    const topic = await topicWithExplainer(t);

    const explainer = await t.core.explainer(topic.id);
    expect(explainer!.current!.content.form).toBe("animation");
    expect(explainer!.current!.content.steps).toEqual([
      { caption: "The consumer polls for a batch.", highlight: { nodeIds: ["poll"], edgeIds: [] } },
      { caption: "It processes each message.", highlight: { nodeIds: ["process"], edgeIds: ["e1"] } },
      { caption: "Then it commits the offset.", highlight: { nodeIds: ["commit"], edgeIds: ["e2"] } },
    ]);
  });
});

describe("switching an Explainer's form", () => {
  it("switching an animation to an infographic saves a new version with the same content in the other form", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    t.ai.scriptExplainer("Consuming messages", processDraft);
    const topic = await topicWithExplainer(t);
    const before = (await t.core.explainer(topic.id))!.current!;
    t.clock.set(new Date("2026-03-02T10:00:00Z"));

    await t.core.switchExplainerForm({ topicId: topic.id, form: "infographic" });

    const after = (await t.core.explainer(topic.id))!.current!;
    expect(after).toMatchObject({ number: 2, cause: "form_switch", createdAt: new Date("2026-03-02T10:00:00Z") });
    expect(after.content).toEqual({ ...before.content, form: "infographic" });
    expect((await t.core.explainerVersions(topic.id)).map((v) => [v.number, v.cause])).toEqual([
      [2, "form_switch"],
      [1, "generated"],
    ]);
  });

  it("switching an infographic with no steps to an animation asks the AI for steps over its diagram", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t); // unscripted: an infographic with no steps
    const before = (await t.core.explainer(topic.id))!.current!;
    t.ai.scriptExplainerSteps("Consuming messages", [
      { caption: "Everything starts at the Topic.", highlight: { nodeIds: ["n1"], edgeIds: [] } },
    ]);

    await t.core.switchExplainerForm({ topicId: topic.id, form: "animation" });

    expect(t.ai.stepsRequests).toEqual([{ topic: { name: "Consuming messages", description: null }, content: before.content }]);
    const after = (await t.core.explainer(topic.id))!.current!;
    expect(after).toMatchObject({ number: 2, cause: "form_switch" });
    expect(after.content).toEqual({
      ...before.content,
      form: "animation",
      steps: [{ caption: "Everything starts at the Topic.", highlight: { nodeIds: ["n1"], edgeIds: [] } }],
    });
  });

  it("switching back and forth reuses the steps: the AI is asked only once", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);

    await t.core.switchExplainerForm({ topicId: topic.id, form: "animation" });
    await t.core.switchExplainerForm({ topicId: topic.id, form: "infographic" });
    await t.core.switchExplainerForm({ topicId: topic.id, form: "animation" });

    expect(t.ai.stepsRequests).toHaveLength(1);
    const versions = await t.core.explainerVersions(topic.id);
    expect(versions.map((v) => v.number)).toEqual([4, 3, 2, 1]);
    expect((await t.core.explainer(topic.id))!.current!.content.steps.length).toBeGreaterThan(0);
  });

  it("switching to the form it already has saves nothing", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);

    await t.core.switchExplainerForm({ topicId: topic.id, form: "infographic" });

    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("steps that highlight parts not in the diagram are refused, and the Explainer stays as it was", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptExplainerSteps("Consuming messages", [
      { caption: "Look here.", highlight: { nodeIds: ["not-a-node"], edgeIds: [] } },
    ]);

    await expect(t.core.switchExplainerForm({ topicId: topic.id, form: "animation" })).rejects.toThrow(
      "could not turn this Explainer into an animation",
    );
    expect((await t.core.explainer(topic.id))!.current).toMatchObject({ number: 1, content: { form: "infographic" } });
  });

  it("an AI failure while making steps is shown to the learner, and nothing is saved", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptExplainerStepsFailure("Consuming messages", "The AI service is busy. Try again later.");

    await expect(t.core.switchExplainerForm({ topicId: topic.id, form: "animation" })).rejects.toThrow(
      "The AI service is busy. Try again later.",
    );
    expect(await t.core.explainerVersions(topic.id)).toHaveLength(1);
  });

  it("an Explainer still being generated cannot be switched", async () => {
    const t = await createTestCore();
    const text = "Offsets are committed per partition.";
    t.ai.scriptTopicProposals(text, [{ name: "Offsets", description: null }]);
    const note = await t.core.addSource({ kind: "note", title: "Notes", text });
    await t.core.runJobs();
    const [proposal] = await t.core.topicProposals(note.id);
    const topic = await t.core.approveTopic({ proposalId: proposal!.id });

    await expect(t.core.switchExplainerForm({ topicId: topic.id, form: "animation" })).rejects.toThrow("not ready");
  });
});
