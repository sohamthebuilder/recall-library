import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./errors";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** Add a Note whose processing proposes these Topics, process it, and return it with its proposals. */
async function addNoteProposing(
  { core, ai }: TestCore,
  text: string,
  proposals: { name: string; description?: string }[],
) {
  ai.scriptTopicProposals(
    text,
    proposals.map((p) => ({ name: p.name, description: p.description ?? null })),
  );
  const note = await core.addSource({ kind: "note", title: text.slice(0, 20), text });
  await core.runJobs();
  const proposed = await core.topicProposals(note.id);
  const byName = (name: string) => proposed.find((p) => p.name === name)!;
  return { note, proposed, byName };
}

describe("approving proposed Topics", () => {
  it("approving a new Topic creates it, drawing on the Source", async () => {
    const t = await createTestCore();
    const { note, byName } = await addNoteProposing(t, "Consumer groups share partitions.", [
      { name: "Kafka consumer groups", description: "How consumers share partitions" },
    ]);

    const topic = await t.core.approveTopic({ proposalId: byName("Kafka consumer groups").id });

    expect(await t.core.topics()).toEqual([
      { id: topic.id, name: "Kafka consumer groups", description: "How consumers share partitions", sourceCount: 1 },
    ]);
    expect((await t.core.topic(topic.id)).sources.map((s) => s.id)).toEqual([note.id]);
    expect(await t.core.topicProposals(note.id)).toEqual([
      expect.objectContaining({ status: "approved", resolvedTopic: { topicId: topic.id, name: "Kafka consumer groups" } }),
    ]);
  });

  it("can rename a proposed Topic while approving it", async () => {
    const t = await createTestCore();
    const { byName } = await addNoteProposing(t, "Consumer groups share partitions.", [
      { name: "Consumer groups" },
    ]);

    await t.core.approveTopic({ proposalId: byName("Consumer groups").id, name: "  Kafka consumer groups " });

    expect((await t.core.topics()).map((x) => x.name)).toEqual(["Kafka consumer groups"]);
  });

  it("refuses a blank new name, and a name an existing Topic already has", async () => {
    const t = await createTestCore();
    const { byName } = await addNoteProposing(t, "Two things.", [{ name: "Offsets" }, { name: "Retries" }]);
    await t.core.approveTopic({ proposalId: byName("Offsets").id });

    await expect(t.core.approveTopic({ proposalId: byName("Retries").id, name: "  " })).rejects.toThrow(ValidationError);
    await expect(t.core.approveTopic({ proposalId: byName("Retries").id, name: "offsets" })).rejects.toThrow(
      ValidationError,
    );
    expect((await t.core.topics()).map((x) => x.name)).toEqual(["Offsets"]);
  });

  it("rejecting a proposed Topic links nothing", async () => {
    const t = await createTestCore();
    const { note, byName } = await addNoteProposing(t, "A tangent about lunch.", [{ name: "Lunch" }]);

    await t.core.rejectTopic(byName("Lunch").id);

    expect(await t.core.topics()).toEqual([]);
    expect(await t.core.topicProposals(note.id)).toEqual([expect.objectContaining({ name: "Lunch", status: "rejected" })]);
  });

  it("a decided proposal cannot be decided again", async () => {
    const t = await createTestCore();
    const { byName } = await addNoteProposing(t, "Offsets.", [{ name: "Offsets" }]);
    await t.core.rejectTopic(byName("Offsets").id);

    await expect(t.core.approveTopic({ proposalId: byName("Offsets").id })).rejects.toThrow(ValidationError);
  });
});

describe("matching proposed Topics to existing Topics", () => {
  it("matches a proposal to a similar existing Topic when the AI confirms it, and approving links the new Source to it", async () => {
    const t = await createTestCore();
    t.ai.scriptEmbedding("Kafka consumer groups: How consumers share partitions", [1, 0, 0]);
    t.ai.scriptEmbedding("Consumer group rebalancing: What happens when a consumer leaves", [0.95, 0.05, 0]);
    const first = await addNoteProposing(t, "First note.", [
      { name: "Kafka consumer groups", description: "How consumers share partitions" },
    ]);
    const existing = await t.core.approveTopic({ proposalId: first.byName("Kafka consumer groups").id });

    t.ai.scriptTopicMatch("Consumer group rebalancing", "Kafka consumer groups");
    const second = await addNoteProposing(t, "Second note.", [
      { name: "Consumer group rebalancing", description: "What happens when a consumer leaves" },
    ]);

    const proposal = second.byName("Consumer group rebalancing");
    expect(proposal.match).toEqual({ topicId: existing.id, name: "Kafka consumer groups" });

    await t.core.approveTopic({ proposalId: proposal.id });

    expect(await t.core.topics()).toEqual([expect.objectContaining({ id: existing.id, sourceCount: 2 })]);
    expect((await t.core.topic(existing.id)).sources.map((s) => s.id).sort()).toEqual(
      [first.note.id, second.note.id].sort(),
    );
  });

  it("marks a proposal new when the AI says the similar Topic is a different one", async () => {
    const t = await createTestCore();
    t.ai.scriptEmbedding("Kafka offsets", [1, 0]).scriptEmbedding("Kafka offset commits", [0.9, 0.1]);
    const first = await addNoteProposing(t, "First note.", [{ name: "Kafka offsets" }]);
    await t.core.approveTopic({ proposalId: first.byName("Kafka offsets").id });

    t.ai.scriptTopicMatch("Kafka offset commits", null);
    const second = await addNoteProposing(t, "Second note.", [{ name: "Kafka offset commits" }]);

    expect(second.byName("Kafka offset commits").match).toBeNull();
    expect(t.ai.matchRequests.map((r) => r.existing.map((e) => e.name))).toEqual([["Kafka offsets"]]);
  });

  it("does not ask the AI about existing Topics that are not similar", async () => {
    const t = await createTestCore();
    t.ai.scriptEmbedding("Kafka offsets", [1, 0]).scriptEmbedding("Sourdough starters", [0, 1]);
    const first = await addNoteProposing(t, "First note.", [{ name: "Kafka offsets" }]);
    await t.core.approveTopic({ proposalId: first.byName("Kafka offsets").id });

    t.ai.scriptTopicMatch("Sourdough starters", "Kafka offsets");
    const second = await addNoteProposing(t, "Second note.", [{ name: "Sourdough starters" }]);

    expect(second.byName("Sourdough starters").match).toBeNull();
    expect(t.ai.matchRequests).toEqual([]);
  });

  it("matches a proposal with the same name as an existing Topic without asking the AI", async () => {
    const t = await createTestCore();
    const first = await addNoteProposing(t, "First note.", [{ name: "Kafka offsets", description: "one" }]);
    const existing = await t.core.approveTopic({ proposalId: first.byName("Kafka offsets").id });

    const second = await addNoteProposing(t, "Second note.", [{ name: "kafka OFFSETS", description: "two" }]);

    expect(second.byName("kafka OFFSETS").match).toEqual({ topicId: existing.id, name: "Kafka offsets" });
    expect(t.ai.matchRequests).toEqual([]);
  });

  it("can approve a matched proposal as a separate new Topic by renaming it", async () => {
    const t = await createTestCore();
    const first = await addNoteProposing(t, "First note.", [{ name: "Kafka offsets" }]);
    await t.core.approveTopic({ proposalId: first.byName("Kafka offsets").id });
    const second = await addNoteProposing(t, "Second note.", [{ name: "Kafka offsets" }]);

    await t.core.approveTopic({ proposalId: second.byName("Kafka offsets").id, name: "Kafka offset retention" });

    expect((await t.core.topics()).map((x) => [x.name, x.sourceCount])).toEqual([
      ["Kafka offset retention", 1],
      ["Kafka offsets", 1],
    ]);
  });
});

describe("merging a proposed Topic into an existing Topic", () => {
  it("links the Source to the chosen Topic instead of creating a new one", async () => {
    const t = await createTestCore();
    const first = await addNoteProposing(t, "First note.", [{ name: "Distributed logs" }]);
    const logs = await t.core.approveTopic({ proposalId: first.byName("Distributed logs").id });
    const second = await addNoteProposing(t, "Second note.", [{ name: "Append-only commit log" }]);

    await t.core.mergeTopic({ proposalId: second.byName("Append-only commit log").id, intoTopicId: logs.id });

    expect(await t.core.topics()).toEqual([expect.objectContaining({ name: "Distributed logs", sourceCount: 2 })]);
    expect(await t.core.topicProposals(second.note.id)).toEqual([
      expect.objectContaining({ status: "approved", resolvedTopic: { topicId: logs.id, name: "Distributed logs" } }),
    ]);
  });
});

describe("Topics and Sources", () => {
  it("a Source can cover many Topics, and only approved ones count", async () => {
    const t = await createTestCore();
    const { note, byName } = await addNoteProposing(t, "Kafka overview.", [
      { name: "Consumer groups" },
      { name: "Offsets" },
      { name: "Lunch" },
    ]);

    const groups = await t.core.approveTopic({ proposalId: byName("Consumer groups").id });
    const offsets = await t.core.approveTopic({ proposalId: byName("Offsets").id });
    await t.core.rejectTopic(byName("Lunch").id);

    expect((await t.core.topics()).map((x) => x.name)).toEqual(["Consumer groups", "Offsets"]);
    expect((await t.core.topic(groups.id)).sources.map((s) => s.id)).toEqual([note.id]);
    expect((await t.core.topic(offsets.id)).sources.map((s) => s.id)).toEqual([note.id]);
  });

  it("a pending proposal does not make a Source count for its matched Topic", async () => {
    const t = await createTestCore();
    const first = await addNoteProposing(t, "First note.", [{ name: "Offsets" }]);
    const offsets = await t.core.approveTopic({ proposalId: first.byName("Offsets").id });

    await addNoteProposing(t, "Second note.", [{ name: "Offsets" }]);

    expect((await t.core.topic(offsets.id)).sources.map((s) => s.id)).toEqual([first.note.id]);
  });

  it("deleting a Topic removes it and its links but keeps its Sources", async () => {
    const t = await createTestCore();
    const { note, byName } = await addNoteProposing(t, "Kafka overview.", [{ name: "Offsets" }, { name: "Retries" }]);
    const offsets = await t.core.approveTopic({ proposalId: byName("Offsets").id });
    await t.core.approveTopic({ proposalId: byName("Retries").id });

    await t.core.deleteTopic(offsets.id);

    expect((await t.core.topics()).map((x) => x.name)).toEqual(["Retries"]);
    expect((await t.core.library()).sources.map((s) => s.id)).toEqual([note.id]);
    await expect(t.core.topic(offsets.id)).rejects.toThrow();
  });

  it("a proposal matched to a deleted Topic becomes a new Topic", async () => {
    const t = await createTestCore();
    const first = await addNoteProposing(t, "First note.", [{ name: "Offsets" }]);
    const offsets = await t.core.approveTopic({ proposalId: first.byName("Offsets").id });
    const second = await addNoteProposing(t, "Second note.", [{ name: "Offsets" }]);

    await t.core.deleteTopic(offsets.id);

    expect(second.byName("Offsets").match).not.toBeNull();
    const [proposal] = await t.core.topicProposals(second.note.id);
    expect(proposal!.match).toBeNull();
    await t.core.approveTopic({ proposalId: proposal!.id });
    expect(await t.core.topics()).toEqual([expect.objectContaining({ name: "Offsets", sourceCount: 1 })]);
  });
});
