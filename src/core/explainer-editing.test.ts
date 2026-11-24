import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";
import type { GenerateExplainerInput } from "./ports/ai";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** A generated Explainer with two cited key points, an analogy and a small labelled diagram. */
function draft({ passages }: GenerateExplainerInput) {
  return {
    form: "infographic",
    title: "Consumer groups",
    keyPoints: [
      { id: "kp1", text: "Each partition is read by one consumer in a group.", citations: [{ chunkId: passages[0]!.chunkId }] },
      { id: "kp2", text: "Adding consumers spreads the partitions.", citations: [{ chunkId: passages[0]!.chunkId }] },
    ],
    analogy: "Like checkout lanes with one cashier each.",
    diagram: {
      groups: [{ id: "g1", label: "Group A" }],
      nodes: [
        { id: "p", label: "Partition", groupId: null },
        { id: "c", label: "Consumer", groupId: "g1" },
      ],
      edges: [{ id: "e1", from: "p", to: "c", label: "read by" }],
    },
    steps: [],
  };
}

const SOURCE_TEXT = "In a consumer group each partition is read by exactly one consumer.";

async function topicWithExplainer(t: TestCore, topicName = "Kafka consumer groups") {
  t.ai.scriptTopicProposals(SOURCE_TEXT, [{ name: topicName, description: null }]);
  t.ai.scriptExplainer(topicName, draft);
  const note = await t.core.addSource({ kind: "note", title: "Kafka notes", text: SOURCE_TEXT });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  return topic;
}

describe("editing an Explainer's text", () => {
  it("changing the title and a key point saves a new text_edit version; citations stay with their key point", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    t.clock.set(new Date("2026-03-02T10:00:00Z"));

    await t.core.editExplainerText({
      topicId: topic.id,
      title: "  How consumer groups share work ",
      keyPoints: [
        { id: "kp1", text: "One partition, one consumer (within a group)." },
        { id: "kp2", text: "Adding consumers spreads the partitions." },
      ],
    });

    const current = (await t.core.explainer(topic.id))!.current!;
    expect(current).toMatchObject({ number: 2, cause: "text_edit", createdAt: new Date("2026-03-02T10:00:00Z") });
    expect(current.content).toEqual({
      ...v1.content,
      title: "How consumer groups share work",
      keyPoints: [
        { ...v1.content.keyPoints[0]!, text: "One partition, one consumer (within a group)." },
        v1.content.keyPoints[1],
      ],
    });
    expect((await t.core.explainerVersions(topic.id)).map((v) => [v.number, v.cause])).toEqual([
      [2, "text_edit"],
      [1, "generated"],
    ]);
  });

  it("the learner can rewrite the analogy (or remove it) and relabel the diagram's nodes, edges and groups", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;

    await t.core.editExplainerText({
      topicId: topic.id,
      analogy: "Like a pizza shared out: each slice goes to one person.",
      nodeLabels: { c: "Consumer instance" },
      edgeLabels: { e1: " " },
      groupLabels: { g1: "Consumer group" },
    });
    const v2 = (await t.core.explainer(topic.id))!.current!;
    expect(v2.content).toEqual({
      ...v1.content,
      analogy: "Like a pizza shared out: each slice goes to one person.",
      diagram: {
        groups: [{ id: "g1", label: "Consumer group" }],
        nodes: [v1.content.diagram.nodes[0], { id: "c", label: "Consumer instance", groupId: "g1" }],
        edges: [{ id: "e1", from: "p", to: "c", label: null }],
      },
    });

    await t.core.editExplainerText({ topicId: topic.id, analogy: "   " });
    expect((await t.core.explainer(topic.id))!.current!.content.analogy).toBeNull();
  });

  it("the learner can reorder, remove and add key points; a new point cites nothing", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;

    await t.core.editExplainerText({
      topicId: topic.id,
      keyPoints: [{ text: "Offsets are tracked per group." }, { id: "kp1", text: v1.content.keyPoints[0]!.text }],
    });

    const { keyPoints } = (await t.core.explainer(topic.id))!.current!.content;
    expect(keyPoints).toEqual([
      { id: expect.any(String), text: "Offsets are tracked per group.", citations: [] },
      v1.content.keyPoints[0],
    ]);
    expect(keyPoints[0]!.id).not.toBe("kp1");
    expect(keyPoints[0]!.id).not.toBe("kp2");
  });

  it("an edit that leaves a blank title or key point, or no key points, is refused and saves nothing", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);

    await expect(t.core.editExplainerText({ topicId: topic.id, title: "  " })).rejects.toThrow(ValidationError);
    await expect(t.core.editExplainerText({ topicId: topic.id, keyPoints: [] })).rejects.toThrow(ValidationError);
    await expect(
      t.core.editExplainerText({ topicId: topic.id, keyPoints: [{ id: "kp1", text: " " }] }),
    ).rejects.toThrow(ValidationError);
    await expect(t.core.editExplainerText({ topicId: topic.id, nodeLabels: { c: "" } })).rejects.toThrow(ValidationError);

    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("an edit that changes nothing saves no new version", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;

    await t.core.editExplainerText({
      topicId: topic.id,
      title: v1.content.title,
      keyPoints: v1.content.keyPoints.map(({ id, text }) => ({ id, text })),
      analogy: v1.content.analogy,
    });

    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("an edit made to a version that is no longer current is refused, so a newer change is not overwritten", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    await t.core.editExplainerText({ topicId: topic.id, baseVersionId: v1.id, title: "Edited in one tab" });

    await expect(
      t.core.editExplainerText({ topicId: topic.id, baseVersionId: v1.id, title: "Edited in another tab" }),
    ).rejects.toThrow(ValidationError);
    expect((await t.core.explainer(topic.id))!.current!.content.title).toBe("Edited in one tab");
  });

  it("editing a Topic with no Explainer, or a missing Topic, is refused", async () => {
    const t = await createTestCore();
    const { created } = await t.core.importTopics("Raft elections");
    await expect(t.core.editExplainerText({ topicId: created[0]!.id, title: "X" })).rejects.toThrow(NotFoundError);
    await expect(
      t.core.editExplainerText({ topicId: "00000000-0000-0000-0000-000000000000", title: "X" }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("browsing and restoring versions", () => {
  it("the learner can open any earlier version, with the passages it cites", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    await t.core.editExplainerText({ topicId: topic.id, title: "My title" });

    const opened = await t.core.explainerVersion({ topicId: topic.id, versionId: v1.id });

    expect(opened.version).toEqual(v1);
    expect(opened.isCurrent).toBe(false);
    const [chunkId] = v1.content.keyPoints[0]!.citations.map((c) => c.chunkId);
    expect(opened.passages[chunkId!]).toMatchObject({ status: "available", text: SOURCE_TEXT });
  });

  it("restoring an earlier version saves its content as a new version, recording which one was restored", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    await t.core.editExplainerText({ topicId: topic.id, title: "A bad rewrite" });
    t.clock.set(new Date("2026-03-03T10:00:00Z"));

    await t.core.restoreExplainerVersion({ topicId: topic.id, versionId: v1.id });

    const current = (await t.core.explainer(topic.id))!.current!;
    expect(current).toMatchObject({ number: 3, cause: "restore", createdAt: new Date("2026-03-03T10:00:00Z") });
    expect(current.content).toEqual(v1.content);
    expect((await t.core.explainerVersions(topic.id)).map((v) => [v.number, v.cause, v.restoredFrom])).toEqual([
      [3, "restore", 1],
      [2, "text_edit", null],
      [1, "generated", null],
    ]);
    // The edited version is still there, unchanged, and can itself be restored later.
    const v2 = await t.core.explainerVersions(topic.id).then((vs) => vs.find((v) => v.number === 2)!);
    expect((await t.core.explainerVersion({ topicId: topic.id, versionId: v2.id })).version.content.title).toBe(
      "A bad rewrite",
    );
  });

  it("restoring the current version, or a version of another Topic's Explainer, is refused", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const other = await topicWithExplainer(t, "Raft elections");
    const current = (await t.core.explainer(topic.id))!.current!;
    const otherV1 = (await t.core.explainer(other.id))!.current!;

    await expect(t.core.restoreExplainerVersion({ topicId: topic.id, versionId: current.id })).rejects.toThrow(
      ValidationError,
    );
    await expect(t.core.restoreExplainerVersion({ topicId: topic.id, versionId: otherV1.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(t.core.explainerVersion({ topicId: topic.id, versionId: otherV1.id })).rejects.toThrow(NotFoundError);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });
});

describe("comparing the Explainer with its Sources", () => {
  it("shows each current key point next to the passages it cites, and what the AI first wrote where the learner changed it", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const v1 = (await t.core.explainer(topic.id))!.current!;
    await t.core.editExplainerText({
      topicId: topic.id,
      keyPoints: [
        { id: "kp1", text: "One partition, one consumer (within a group)." },
        { id: "kp2", text: v1.content.keyPoints[1]!.text },
        { text: "My own point." },
      ],
    });

    const comparison = await t.core.explainerComparison(topic.id);

    const passage = { status: "available", sourceTitle: "Kafka notes", text: SOURCE_TEXT };
    expect(comparison).toMatchObject([
      {
        keyPointId: "kp1",
        text: "One partition, one consumer (within a group).",
        generatedText: "Each partition is read by one consumer in a group.",
        edited: true,
        passages: [passage],
      },
      { keyPointId: "kp2", text: v1.content.keyPoints[1]!.text, generatedText: v1.content.keyPoints[1]!.text, edited: false, passages: [passage] },
      { text: "My own point.", generatedText: null, edited: true, passages: [] },
    ]);
  });

  it("a passage whose Source was deleted shows as removed", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    const [source] = (await t.core.topic(topic.id)).sources;
    await t.core.deleteSource(source!.id);

    const [row] = await t.core.explainerComparison(topic.id);
    expect(row!.passages).toMatchObject([{ status: "source_removed", sourceId: source!.id }]);
  });
});
