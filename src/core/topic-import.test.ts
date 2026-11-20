import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";

describe("importing a list of Topics", () => {
  it("creates one Topic per non-empty line, each waiting for a Source", async () => {
    const t = await createTestCore();

    const result = await t.core.importTopics("Kafka consumer groups\n\n  Raft leader election  \r\n   \nB-trees\n");

    expect(result.created.map((x) => x.name)).toEqual(["Kafka consumer groups", "Raft leader election", "B-trees"]);
    expect(result.skipped).toEqual([]);
    expect((await t.core.topics()).map((x) => [x.name, x.sourceCount])).toEqual([
      ["B-trees", 0],
      ["Kafka consumer groups", 0],
      ["Raft leader election", 0],
    ]);
  });

  it("skips names an existing Topic already has, or that are listed twice, ignoring case", async () => {
    const t = await createTestCore();
    await t.core.importTopics("Kafka consumer groups");

    const result = await t.core.importTopics("kafka CONSUMER groups\nB-trees\nb-trees");

    expect(result.created.map((x) => x.name)).toEqual(["B-trees"]);
    expect(result.skipped).toEqual(["kafka CONSUMER groups", "b-trees"]);
    expect((await t.core.topics()).map((x) => x.name)).toEqual(["B-trees", "Kafka consumer groups"]);
  });

  it("refuses a list with no Topics in it", async () => {
    const t = await createTestCore();

    await expect(t.core.importTopics("  \n\n ")).rejects.toThrow(ValidationError);
  });

  it("an imported Topic waits for a Source: nothing is generated for it", async () => {
    const t = await createTestCore();

    const { created } = await t.core.importTopics("Raft leader election");

    expect(await t.core.topic(created[0]!.id)).toEqual(expect.objectContaining({ sourceCount: 0, sources: [] }));
    expect(await t.core.runJobs()).toEqual({ ran: 0, failed: 0 });
  });
});

describe("a later Source attaching to an imported Topic", () => {
  it("a proposed Topic with the same name matches the imported Topic, and approving links the Source", async () => {
    const t = await createTestCore();
    const { created } = await t.core.importTopics("Kafka consumer groups");
    const imported = created[0]!;

    t.ai.scriptTopicProposals("Consumer groups share partitions.", [{ name: "kafka consumer groups", description: null }]);
    const note = await t.core.addSource({ kind: "note", title: "Groups", text: "Consumer groups share partitions." });
    await t.core.runJobs();
    const [proposal] = await t.core.topicProposals(note.id);

    expect(proposal!.match).toEqual({ topicId: imported.id, name: "Kafka consumer groups" });
    await t.core.approveTopic({ proposalId: proposal!.id });
    expect((await t.core.topic(imported.id)).sources.map((s) => s.id)).toEqual([note.id]);
  });

  it("a similar proposed Topic matches the imported Topic when the AI confirms it", async () => {
    const t = await createTestCore();
    t.ai.scriptEmbedding("Kafka consumer groups", [1, 0, 0]);
    t.ai.scriptEmbedding("Consumer group rebalancing", [0.95, 0.05, 0]);
    const { created } = await t.core.importTopics("Kafka consumer groups");

    t.ai.scriptTopicMatch("Consumer group rebalancing", "Kafka consumer groups");
    t.ai.scriptTopicProposals("Rebalancing.", [{ name: "Consumer group rebalancing", description: null }]);
    const note = await t.core.addSource({ kind: "note", title: "Rebalancing", text: "Rebalancing." });
    await t.core.runJobs();

    expect((await t.core.topicProposals(note.id))[0]!.match).toEqual({
      topicId: created[0]!.id,
      name: "Kafka consumer groups",
    });
  });
});

describe("linking a Source to a Topic by hand", () => {
  it("links an existing Source to a Topic as an approved link", async () => {
    const t = await createTestCore();
    const { created } = await t.core.importTopics("Raft leader election");
    const note = await t.core.addSource({ kind: "note", title: "Raft", text: "Leaders win elections by majority." });
    await t.core.runJobs();

    const topic = await t.core.linkSourceToTopic({ topicId: created[0]!.id, sourceId: note.id });

    expect(topic).toEqual(expect.objectContaining({ id: created[0]!.id, sourceCount: 1 }));
    expect((await t.core.topic(created[0]!.id)).sources.map((s) => s.id)).toEqual([note.id]);
  });

  it("linking the same Source twice keeps one link", async () => {
    const t = await createTestCore();
    const { created } = await t.core.importTopics("Raft leader election");
    const note = await t.core.addSource({ kind: "note", title: "Raft", text: "Majority." });

    await t.core.linkSourceToTopic({ topicId: created[0]!.id, sourceId: note.id });
    await t.core.linkSourceToTopic({ topicId: created[0]!.id, sourceId: note.id });

    expect(await t.core.topics()).toEqual([expect.objectContaining({ sourceCount: 1 })]);
  });

  it("refuses a Topic or Source that does not exist", async () => {
    const t = await createTestCore();
    const { created } = await t.core.importTopics("Raft leader election");
    const note = await t.core.addSource({ kind: "note", title: "Raft", text: "Majority." });
    await t.core.deleteTopic(created[0]!.id);

    await expect(t.core.linkSourceToTopic({ topicId: created[0]!.id, sourceId: note.id })).rejects.toThrow(
      NotFoundError,
    );
    const { created: again } = await t.core.importTopics("Raft leader election");
    await expect(
      t.core.linkSourceToTopic({ topicId: again[0]!.id, sourceId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(NotFoundError);
  });
});
