import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError } from "./errors";

const utf8 = (s: string) => new TextEncoder().encode(s);

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** A processed Note linked to a new Topic with this name, whose Explainer v1 has been generated. */
async function noteWithExplainer({ core, ai }: TestCore, text: string, topicName: string) {
  ai.scriptTopicProposals(text, [{ name: topicName, description: null }]);
  const note = await core.addSource({ kind: "note", title: topicName, text });
  await core.runJobs();
  const [proposal] = await core.topicProposals(note.id);
  const topic = await core.approveTopic({ proposalId: proposal!.id });
  await core.runJobs();
  return { note, topic };
}

describe("deleting a Source", () => {
  it("removes the Source and its chunks, leaves the Explainer unchanged and marks its citations Source removed", async () => {
    const t = await createTestCore();
    const { note, topic } = await noteWithExplainer(t, "Offsets are tracked per partition.", "Kafka offsets");
    const [chunk] = await t.core.sourceChunks(note.id);
    const before = await t.core.explainer(topic.id);
    const versionsBefore = await t.core.explainerVersions(topic.id);

    await t.core.deleteSource(note.id);

    expect((await t.core.library()).sources).toEqual([]);
    await expect(t.core.source(note.id)).rejects.toThrow(NotFoundError);
    expect(await t.core.similarChunks({ text: "Offsets are tracked per partition." })).toEqual([]);

    const after = await t.core.explainer(topic.id);
    expect(after!.current).toEqual(before!.current);
    expect(await t.core.explainerVersions(topic.id)).toEqual(versionsBefore);
    expect(after!.passages[chunk!.id]).toEqual({ status: "source_removed", chunkId: chunk!.id, sourceId: note.id });
  });

  it("removes the stored file of an uploaded Source", async () => {
    const t = await createTestCore();
    const kept = await t.core.addSource({ kind: "markdown", file: { name: "kept.md", bytes: utf8("# Kept") } });
    const doomed = await t.core.addSource({ kind: "markdown", file: { name: "doomed.md", bytes: utf8("# Doomed") } });
    await t.core.runJobs();

    await t.core.deleteSource(doomed.id);

    expect(t.fileStore.storedFiles().map((f) => f.key)).toEqual([expect.stringContaining("kept.md")]);
    expect((await t.core.library()).sources.map((s) => s.id)).toEqual([kept.id]);
  });

  it("counts the Explainers that cite a Source, so the learner can be warned before deleting it", async () => {
    const t = await createTestCore();
    const text = "Consumer groups share partitions. Offsets are tracked per partition.";
    t.ai.scriptTopicProposals(text, [
      { name: "Consumer groups", description: null },
      { name: "Offsets", description: null },
    ]);
    const cited = await t.core.addSource({ kind: "note", title: "Kafka", text });
    await t.core.runJobs();
    for (const proposal of await t.core.topicProposals(cited.id)) await t.core.approveTopic({ proposalId: proposal.id });
    await t.core.runJobs();
    const other = await noteWithExplainer(t, "Raft elects a leader.", "Raft");

    expect(await t.core.explainersCitingSource(cited.id)).toBe(2);
    expect(await t.core.explainersCitingSource(other.note.id)).toBe(1);

    const uncited = await t.core.addSource({ kind: "note", text: "Not linked to anything." });
    await t.core.runJobs();
    expect(await t.core.explainersCitingSource(uncited.id)).toBe(0);
  });

  it("refuses a Source that no longer exists", async () => {
    const t = await createTestCore();
    const note = await t.core.addSource({ kind: "note", text: "Short-lived." });
    await t.core.deleteSource(note.id);

    await expect(t.core.deleteSource(note.id)).rejects.toThrow(NotFoundError);
    await expect(t.core.explainersCitingSource(note.id)).rejects.toThrow(NotFoundError);
  });

  it("never creates a new Explainer version, even after jobs run and the Topic has lost every Source", async () => {
    const t = await createTestCore();
    const first = await noteWithExplainer(t, "Leaders handle all writes.", "Replication");
    t.ai.scriptTopicProposals("Followers copy the leader's log.", [{ name: "Replication", description: null }]);
    const second = await t.core.addSource({ kind: "note", title: "More", text: "Followers copy the leader's log." });
    await t.core.runJobs();
    const [proposal] = await t.core.topicProposals(second.id);
    await t.core.approveTopic({ proposalId: proposal!.id });
    await t.core.runJobs();
    const before = await t.core.explainer(first.topic.id);
    const versionsBefore = await t.core.explainerVersions(first.topic.id);
    const explainerRequests = t.ai.explainerRequests.length;

    await t.core.deleteSource(second.id);
    await t.core.runJobs();
    await t.core.deleteSource(first.note.id);
    await t.core.runJobs();

    expect(await t.core.explainerVersions(first.topic.id)).toEqual(versionsBefore);
    const after = await t.core.explainer(first.topic.id);
    expect(after).toMatchObject({ status: "ready", current: before!.current });
    expect(Object.values(after!.passages).every((p) => p.status === "source_removed")).toBe(true);
    expect(t.ai.explainerRequests).toHaveLength(explainerRequests);
  });
});
