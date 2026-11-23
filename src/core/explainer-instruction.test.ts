import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import type { ExplainerContent } from "./explainer-content";
import { ValidationError } from "./errors";
import type { GenerateExplainerInput } from "./ports/ai";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

const SOURCE_TEXT = "In a consumer group each partition is read by exactly one consumer.";
const TOPIC = "Kafka consumer groups";

function draft({ passages }: GenerateExplainerInput) {
  return {
    form: "infographic",
    title: "Consumer groups",
    keyPoints: [
      { id: "kp1", text: "Each partition is read by one consumer in a group.", citations: [{ chunkId: passages[0]!.chunkId }] },
    ],
    analogy: null,
    diagram: {
      groups: [],
      nodes: [
        { id: "p", label: "Partition", groupId: null },
        { id: "c", label: "Consumer", groupId: null },
      ],
      edges: [{ id: "e1", from: "p", to: "c", label: "read by" }],
    },
    steps: [],
  };
}

async function topicWithExplainer(t: TestCore) {
  t.ai.scriptTopicProposals(SOURCE_TEXT, [{ name: TOPIC, description: null }]);
  t.ai.scriptExplainer(TOPIC, draft);
  const note = await t.core.addSource({ kind: "note", title: "Kafka notes", text: SOURCE_TEXT });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  return topic;
}

/** The current content reshaped the way "use a restaurant analogy, show the partitions" would. */
function reshaped(content: ExplainerContent) {
  const chunkId = content.keyPoints[0]!.citations[0]!.chunkId;
  return {
    ...content,
    keyPoints: [
      ...content.keyPoints.map((k) => ({ id: k.id, text: k.text, citations: k.citations.map((c) => ({ chunkId: c.chunkId })) })),
      { id: "kp2", text: "Partitions are split across the group.", citations: [{ chunkId }] },
    ],
    analogy: "Like tables in a restaurant, each served by one waiter.",
    diagram: {
      groups: [],
      nodes: [
        { id: "p1", label: "Partition 1", groupId: null },
        { id: "p2", label: "Partition 2", groupId: null },
        { id: "c", label: "Consumer", groupId: null },
      ],
      edges: [
        { id: "e1", from: "p1", to: "c", label: "read by" },
        { id: "e2", from: "p2", to: "c", label: "read by" },
      ],
    },
  };
}

describe("editing an Explainer by instruction", () => {
  it("a valid AI result is saved as a new version caused by the instruction, and Recall Prompts are reconciled", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    t.ai.scriptExplainerInstruction(TOPIC, ({ explainer }) => reshaped(explainer));
    t.clock.set(new Date("2026-03-02T10:00:00Z"));

    await t.core.editExplainerByInstruction({ topicId: topic.id, instruction: "  Use a restaurant analogy and show the partitions " });

    const request = t.ai.instructionRequests[0]!;
    expect(request.instruction).toBe("Use a restaurant analogy and show the partitions");
    expect(request.explainer).toEqual(v1.content);
    expect(request.passages).toEqual([
      { chunkId: v1.content.keyPoints[0]!.citations[0]!.chunkId, sourceTitle: "Kafka notes", text: SOURCE_TEXT },
    ]);

    const current = (await t.core.explainer(topic.id))!.current!;
    const citation = v1.content.keyPoints[0]!.citations[0]!;
    expect(current).toMatchObject({ number: 2, cause: "instruction", createdAt: new Date("2026-03-02T10:00:00Z") });
    expect(current.content.analogy).toBe("Like tables in a restaurant, each served by one waiter.");
    expect(current.content.diagram.nodes.map((n) => n.label)).toEqual(["Partition 1", "Partition 2", "Consumer"]);
    expect(current.content.keyPoints[1]).toEqual({ id: "kp2", text: "Partitions are split across the group.", citations: [citation] });

    const reconciliationsBefore = t.ai.reconciliationRequests.length;
    await t.core.runJobs();
    expect(t.ai.reconciliationRequests.length).toBe(reconciliationsBefore + 1);
    expect(t.ai.reconciliationRequests.at(-1)!.explainer).toEqual(current.content);
  });

  it("an invalid AI result is rejected with a message and the current version is left unchanged", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const before = await t.core.explainer(topic.id);
    t.ai.scriptExplainerInstruction(TOPIC, ({ explainer }) => ({
      ...reshaped(explainer),
      diagram: { groups: [], nodes: [{ id: "c", label: "Consumer", groupId: null }], edges: [{ id: "e1", from: "p", to: "c", label: null }] },
    }));

    await expect(t.core.editExplainerByInstruction({ topicId: topic.id, instruction: "Show the partitions" })).rejects.toThrow(
      ValidationError,
    );
    expect(await t.core.explainer(topic.id)).toEqual(before);
    expect(await t.core.explainerVersions(topic.id)).toHaveLength(1);
  });

  it("a result citing a passage the Explainer does not cite is rejected", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptExplainerInstruction(TOPIC, ({ explainer }) => ({
      ...reshaped(explainer),
      keyPoints: [{ id: "kp1", text: "Made up.", citations: [{ chunkId: "00000000-0000-0000-0000-000000000000" }] }],
    }));

    await expect(t.core.editExplainerByInstruction({ topicId: topic.id, instruction: "Cite more" })).rejects.toThrow(
      /could not be used/,
    );
    expect(await t.core.explainerVersions(topic.id)).toHaveLength(1);
  });

  it("an AI failure is shown to the learner and nothing changes", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptExplainerInstructionFailure(TOPIC, "The AI service is busy.");

    await expect(t.core.editExplainerByInstruction({ topicId: topic.id, instruction: "Simpler words" })).rejects.toThrow(
      "The AI service is busy.",
    );
    expect(await t.core.explainerVersions(topic.id)).toHaveLength(1);
  });

  it("a blank instruction is refused without asking the AI", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);

    await expect(t.core.editExplainerByInstruction({ topicId: topic.id, instruction: "   " })).rejects.toThrow(ValidationError);
    expect(t.ai.instructionRequests).toHaveLength(0);
  });

  it("the version history shows the instruction, and the learner can restore the previous version", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    t.ai.scriptExplainerInstruction(TOPIC, ({ explainer }) => reshaped(explainer));
    await t.core.editExplainerByInstruction({ topicId: topic.id, instruction: "Use a restaurant analogy" });

    const [v2] = await t.core.explainerVersions(topic.id);
    expect(v2).toMatchObject({ number: 2, cause: "instruction", instruction: "Use a restaurant analogy" });

    await t.core.restoreExplainerVersion({ topicId: topic.id, versionId: v1.id });
    const current = (await t.core.explainer(topic.id))!.current!;
    expect(current).toMatchObject({ number: 3, cause: "restore", restoredFrom: 1 });
    expect(current.content).toEqual(v1.content);
  });
});
