import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** Add a processed Note that proposes one Topic with this name; returns the Note and its proposal. */
async function addNoteAbout({ core, ai }: TestCore, text: string, topicName: string, title = text.slice(0, 20)) {
  ai.scriptTopicProposals(text, [{ name: topicName, description: null }]);
  const note = await core.addSource({ kind: "note", title, text });
  await core.runJobs();
  const [proposal] = await core.topicProposals(note.id);
  return { note, proposal: proposal! };
}

describe("generating a Topic's Explainer", () => {
  it("approving the first Source for a Topic generates its Explainer as version 1, citing the Source", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const { note, proposal } = await addNoteAbout(
      t,
      "A consumer group shares a topic's partitions among its consumers.",
      "Kafka consumer groups",
      "Kafka notes",
    );
    const [chunk] = await t.core.sourceChunks(note.id);
    t.ai.scriptExplainer("Kafka consumer groups", ({ passages }) => ({
      form: "infographic",
      title: "How consumer groups share work",
      keyPoints: [
        { id: "kp1", text: "Each partition goes to one consumer in the group.", citations: [{ chunkId: passages[0]!.chunkId }] },
      ],
      analogy: "Like checkout lanes shared among cashiers.",
      diagram: {
        groups: [{ id: "g1", label: "Consumer group" }],
        nodes: [
          { id: "p0", label: "Partition 0", groupId: null },
          { id: "c1", label: "Consumer 1", groupId: "g1" },
        ],
        edges: [{ id: "e1", from: "p0", to: "c1", label: "assigned to" }],
      },
      steps: [],
    }));

    const topic = await t.core.approveTopic({ proposalId: proposal.id });
    await t.core.runJobs();

    const explainer = await t.core.explainer(topic.id);
    expect(explainer).toMatchObject({
      topicId: topic.id,
      status: "ready",
      failureReason: null,
      current: {
        number: 1,
        cause: "generated",
        createdAt: new Date("2026-03-01T10:00:00Z"),
        content: {
          form: "infographic",
          title: "How consumer groups share work",
          analogy: "Like checkout lanes shared among cashiers.",
          keyPoints: [
            {
              id: "kp1",
              text: "Each partition goes to one consumer in the group.",
              citations: [{ chunkId: chunk!.id, sourceId: note.id }],
            },
          ],
        },
      },
    });
    expect(explainer!.passages[chunk!.id]).toEqual({
      status: "available",
      chunkId: chunk!.id,
      sourceId: note.id,
      sourceTitle: "Kafka notes",
      text: "A consumer group shares a topic's partitions among its consumers.",
      anchor: chunk!.anchor,
    });
    expect(await t.core.explainerVersions(topic.id)).toEqual([
      { id: explainer!.current!.id, number: 1, cause: "generated", createdAt: new Date("2026-03-01T10:00:00Z") },
    ]);
  });
});

describe("which Topics get an Explainer", () => {
  it("a proposed Topic that is not approved yet gets no Explainer, and the AI is never asked for one", async () => {
    const t = await createTestCore();
    const { proposal } = await addNoteAbout(t, "Offsets record progress.", "Offsets");
    const { proposal: rejected } = await addNoteAbout(t, "Lunch was good.", "Lunch");
    await t.core.rejectTopic(rejected.id);
    await t.core.runJobs();

    expect(t.ai.explainerRequests).toEqual([]);
    const topic = await t.core.approveTopic({ proposalId: proposal.id });
    expect(await t.core.explainer(topic.id)).toMatchObject({ status: "generating", current: null });
  });

  it("a Topic linked to several Sources before generation gets exactly one Explainer drawing on all of them", async () => {
    const t = await createTestCore();
    const a = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets", "Note A");
    const b = await addNoteAbout(t, "Committing offsets too early can lose messages.", "Offsets", "Note B");
    const topic = await t.core.approveTopic({ proposalId: a.proposal.id });
    await t.core.mergeTopic({ proposalId: b.proposal.id, intoTopicId: topic.id });

    await t.core.runJobs();

    expect(t.ai.explainerRequests).toHaveLength(1);
    expect(t.ai.explainerRequests[0]!.passages.map((p) => p.sourceTitle).sort()).toEqual(["Note A", "Note B"]);
    expect(await t.core.explainerVersions(topic.id)).toHaveLength(1);
  });

  it("approving another Source once the Explainer exists never regenerates it (ADR 0001)", async () => {
    const t = await createTestCore();
    const a = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets");
    const topic = await t.core.approveTopic({ proposalId: a.proposal.id });
    await t.core.runJobs();
    const before = await t.core.explainer(topic.id);

    const b = await addNoteAbout(t, "Committing offsets too early can lose messages.", "Offsets");
    await t.core.approveTopic({ proposalId: b.proposal.id });
    await t.core.runJobs();

    expect(t.ai.explainerRequests).toHaveLength(1);
    expect(await t.core.explainer(topic.id)).toEqual(before);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("deleting the Topic deletes its Explainer", async () => {
    const t = await createTestCore();
    const { proposal } = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets");
    const topic = await t.core.approveTopic({ proposalId: proposal.id });
    await t.core.runJobs();

    await t.core.deleteTopic(topic.id);

    await expect(t.core.explainer(topic.id)).rejects.toThrow("no longer exists");
  });
});

describe("when generation does not work", () => {
  it("an invalid Explainer from the AI is not saved; the learner sees why and can retry", async () => {
    const t = await createTestCore();
    const { proposal } = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets");
    t.ai.scriptExplainer("Offsets", {
      form: "infographic",
      title: "Offsets",
      keyPoints: [{ id: "kp1", text: "Made up.", citations: [{ chunkId: "not-a-passage" }] }],
      analogy: null,
      diagram: { groups: [], nodes: [], edges: [{ id: "e1", from: "x", to: "y", label: null }] },
      steps: [],
    });
    const topic = await t.core.approveTopic({ proposalId: proposal.id });
    await t.core.runJobs();

    expect(await t.core.explainer(topic.id)).toMatchObject({
      status: "failed",
      failureReason: "The AI produced an Explainer that could not be used. Try again.",
      current: null,
    });
    expect(await t.core.explainerVersions(topic.id)).toEqual([]);

    t.ai.scriptExplainer("Offsets", ({ passages }) => ({
      form: "infographic",
      title: "Offsets",
      keyPoints: [{ id: "kp1", text: "Offsets are per partition.", citations: [{ chunkId: passages[0]!.chunkId }] }],
      analogy: null,
      diagram: { groups: [], nodes: [{ id: "n1", label: "Partition", groupId: null }], edges: [] },
      steps: [],
    }));
    await t.core.retryExplainer(topic.id);
    await t.core.runJobs();

    expect(await t.core.explainer(topic.id)).toMatchObject({
      status: "ready",
      current: { number: 1, content: { keyPoints: [{ text: "Offsets are per partition." }] } },
    });
  });

  it("a key point that cites nothing is rejected", async () => {
    const t = await createTestCore();
    const { proposal } = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets");
    t.ai.scriptExplainer("Offsets", {
      form: "infographic",
      title: "Offsets",
      keyPoints: [{ id: "kp1", text: "Uncited claim.", citations: [] }],
      analogy: null,
      diagram: { groups: [], nodes: [], edges: [] },
      steps: [],
    });
    const topic = await t.core.approveTopic({ proposalId: proposal.id });
    await t.core.runJobs();

    expect(await t.core.explainer(topic.id)).toMatchObject({ status: "failed", current: null });
  });

  it("an AI failure is shown as the reason; linking another Source tries again", async () => {
    const t = await createTestCore();
    const a = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets");
    t.ai.scriptExplainerFailure("Offsets", "The AI service is busy or out of credit. Try again later.");
    const topic = await t.core.approveTopic({ proposalId: a.proposal.id });
    await t.core.runJobs();
    expect(await t.core.explainer(topic.id)).toMatchObject({
      status: "failed",
      failureReason: "The AI service is busy or out of credit. Try again later.",
    });

    const b = await addNoteAbout(t, "Committing offsets too early can lose messages.", "Offsets");
    await t.core.approveTopic({ proposalId: b.proposal.id });
    await t.core.runJobs();

    expect(await t.core.explainer(topic.id)).toMatchObject({ status: "ready", current: { number: 1 } });
  });

  it("only a failed Explainer can be retried", async () => {
    const t = await createTestCore();
    const { proposal } = await addNoteAbout(t, "Offsets are committed per partition.", "Offsets");
    const topic = await t.core.approveTopic({ proposalId: proposal.id });
    await t.core.runJobs();

    await expect(t.core.retryExplainer(topic.id)).rejects.toThrow("Only an Explainer that failed");
  });
});
