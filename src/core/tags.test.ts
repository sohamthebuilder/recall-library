import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** Approve a Topic with this name, via a Note that proposes it. */
async function approvedTopic({ core, ai }: TestCore, name: string, description: string | null = null) {
  const text = `A Note about ${name}.`;
  ai.scriptTopicProposals(text, [{ name, description }]);
  const note = await core.addSource({ kind: "note", title: name, text });
  await core.runJobs();
  const [proposal] = await core.topicProposals(note.id);
  return core.approveTopic({ proposalId: proposal!.id });
}

const tagNames = (topic: { tags: { name: string }[] }) => topic.tags.map((t) => t.name);

describe("tagging Topics", () => {
  it("a Topic can have several Tags", async () => {
    const t = await createTestCore();
    const topic = await approvedTopic(t, "Kafka consumer groups");

    await t.core.tagTopic({ topicId: topic.id, name: "system design" });
    await t.core.tagTopic({ topicId: topic.id, name: "Kafka" });

    expect(tagNames(await t.core.topic(topic.id))).toEqual(["Kafka", "system design"]);
  });

  it("Tags are shared between Topics by name, ignoring case and extra spaces", async () => {
    const t = await createTestCore();
    const groups = await approvedTopic(t, "Kafka consumer groups");
    const sharding = await approvedTopic(t, "Database sharding");

    const first = await t.core.tagTopic({ topicId: groups.id, name: "System design" });
    const second = await t.core.tagTopic({ topicId: sharding.id, name: "  system   DESIGN " });

    expect(second).toEqual(first);
    expect(await t.core.tags()).toEqual([{ id: first.id, name: "System design", topicCount: 2 }]);
  });

  it("tagging a Topic twice with the same Tag keeps one", async () => {
    const t = await createTestCore();
    const topic = await approvedTopic(t, "Kafka consumer groups");

    await t.core.tagTopic({ topicId: topic.id, name: "Kafka" });
    await t.core.tagTopic({ topicId: topic.id, name: "kafka" });

    expect(tagNames(await t.core.topic(topic.id))).toEqual(["Kafka"]);
  });

  it("removing a Tag from a Topic leaves its other Tags, and other Topics' use of it", async () => {
    const t = await createTestCore();
    const groups = await approvedTopic(t, "Kafka consumer groups");
    const sharding = await approvedTopic(t, "Database sharding");
    const design = await t.core.tagTopic({ topicId: groups.id, name: "system design" });
    await t.core.tagTopic({ topicId: groups.id, name: "Kafka" });
    await t.core.tagTopic({ topicId: sharding.id, name: "system design" });

    await t.core.untagTopic({ topicId: groups.id, tagId: design.id });

    expect(tagNames(await t.core.topic(groups.id))).toEqual(["Kafka"]);
    expect(tagNames(await t.core.topic(sharding.id))).toEqual(["system design"]);
    expect(await t.core.tags()).toEqual([
      expect.objectContaining({ name: "Kafka", topicCount: 1 }),
      expect.objectContaining({ name: "system design", topicCount: 1 }),
    ]);
  });

  it("a Tag no Topic has any more is gone", async () => {
    const t = await createTestCore();
    const groups = await approvedTopic(t, "Kafka consumer groups");
    const sharding = await approvedTopic(t, "Database sharding");
    const kafka = await t.core.tagTopic({ topicId: groups.id, name: "Kafka" });
    await t.core.tagTopic({ topicId: sharding.id, name: "Databases" });

    await t.core.untagTopic({ topicId: groups.id, tagId: kafka.id });
    await t.core.deleteTopic(sharding.id);

    expect(await t.core.tags()).toEqual([]);
    // Re-adding it starts a fresh Tag under the new spelling.
    await t.core.tagTopic({ topicId: groups.id, name: "kafka" });
    expect(tagNames(await t.core.topic(groups.id))).toEqual(["kafka"]);
  });

  it("removing a Tag from a Topic that does not exist is refused", async () => {
    const t = await createTestCore();
    const topic = await approvedTopic(t, "Kafka consumer groups");
    const kafka = await t.core.tagTopic({ topicId: topic.id, name: "Kafka" });
    await t.core.deleteTopic(topic.id);

    await expect(t.core.untagTopic({ topicId: topic.id, tagId: kafka.id })).rejects.toThrow(NotFoundError);
  });

  it("refuses a blank Tag, and a Topic that does not exist", async () => {
    const t = await createTestCore();
    const topic = await approvedTopic(t, "Kafka consumer groups");

    await expect(t.core.tagTopic({ topicId: topic.id, name: "   " })).rejects.toThrow(ValidationError);
    await t.core.deleteTopic(topic.id);
    await expect(t.core.tagTopic({ topicId: topic.id, name: "Kafka" })).rejects.toThrow(NotFoundError);
  });
});

describe("finding Topics", () => {
  /** Three Topics: groups (Kafka, system design), sharding (system design), offsets (Kafka). */
  async function library() {
    const t = await createTestCore();
    const groups = await approvedTopic(t, "Kafka consumer groups", "How consumers share partitions");
    const sharding = await approvedTopic(t, "Database sharding");
    const offsets = await approvedTopic(t, "Consumer offsets");
    const kafka = await t.core.tagTopic({ topicId: groups.id, name: "Kafka" });
    const design = await t.core.tagTopic({ topicId: groups.id, name: "system design" });
    await t.core.tagTopic({ topicId: sharding.id, name: "system design" });
    await t.core.tagTopic({ topicId: offsets.id, name: "Kafka" });
    return { t, kafka, design, groups };
  }
  const names = (topics: { name: string }[]) => topics.map((x) => x.name);

  it("with no search or Tags, finds every Topic by name, each with its Tags", async () => {
    const { t, groups } = await library();

    const found = await t.core.findTopics({});

    expect(names(found)).toEqual(["Consumer offsets", "Database sharding", "Kafka consumer groups"]);
    expect(found.find((x) => x.id === groups.id)).toEqual({
      id: groups.id,
      name: "Kafka consumer groups",
      description: "How consumers share partitions",
      sourceCount: 1,
      tags: [expect.objectContaining({ name: "Kafka" }), expect.objectContaining({ name: "system design" })],
    });
  });

  it("searches Topic names, ignoring case", async () => {
    const { t } = await library();

    expect(names(await t.core.findTopics({ search: "  CONSUMER " }))).toEqual([
      "Consumer offsets",
      "Kafka consumer groups",
    ]);
    expect(await t.core.findTopics({ search: "raft" })).toEqual([]);
  });

  it("treats search text literally, not as a pattern", async () => {
    const { t } = await library();

    expect(await t.core.findTopics({ search: "%" })).toEqual([]);
    expect(await t.core.findTopics({ search: "_" })).toEqual([]);
  });

  it("filters by a Tag", async () => {
    const { t, kafka } = await library();

    expect(names(await t.core.findTopics({ tagIds: [kafka.id] }))).toEqual([
      "Consumer offsets",
      "Kafka consumer groups",
    ]);
  });

  it("filtering by several Tags finds the Topics that have all of them", async () => {
    const { t, kafka, design } = await library();

    expect(names(await t.core.findTopics({ tagIds: [kafka.id, design.id] }))).toEqual(["Kafka consumer groups"]);
  });

  it("Tags are flat: a Tag that looks nested is just another Tag", async () => {
    const { t, design } = await library();
    const raft = await approvedTopic(t, "Raft");
    const nested = await t.core.tagTopic({ topicId: raft.id, name: "system design/consensus" });

    expect(names(await t.core.findTopics({ tagIds: [design.id] }))).not.toContain("Raft");
    expect(names(await t.core.findTopics({ tagIds: [nested.id] }))).toEqual(["Raft"]);
  });

  it("combines search and Tags", async () => {
    const { t, design } = await library();

    expect(names(await t.core.findTopics({ search: "shard", tagIds: [design.id] }))).toEqual(["Database sharding"]);
    expect(await t.core.findTopics({ search: "offsets", tagIds: [design.id] })).toEqual([]);
  });
});
