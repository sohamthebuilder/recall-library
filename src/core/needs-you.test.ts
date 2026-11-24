import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import type { GenerateExplainerInput, SuggestEditsInput } from "./ports/ai";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

async function addNoteProposing(t: TestCore, title: string, text: string, names: string[]) {
  t.ai.scriptTopicProposals(text, names.map((name) => ({ name, description: null })));
  const note = await t.core.addSource({ kind: "note", title, text });
  await t.core.runJobs();
  return { note, proposals: await t.core.topicProposals(note.id) };
}

describe("Topics waiting for approval", () => {
  it("each Source in the Library says how many of its proposed Topics wait for a decision", async () => {
    const t = await createTestCore();
    const { note, proposals } = await addNoteProposing(t, "Kafka notes", "Partitions and offsets.", [
      "Partitions",
      "Offsets",
      "Retries",
    ]);

    await t.core.approveTopic({ proposalId: proposals[0]!.id });
    await t.core.rejectTopic(proposals[1]!.id);

    const [source] = (await t.core.library()).sources;
    expect(source).toMatchObject({ id: note.id, status: "ready", topicsAwaitingApproval: 1 });
  });
});

describe("Needs you", () => {
  it("is empty when nothing waits for the learner", async () => {
    const t = await createTestCore();
    await addNoteProposing(t, "Quiet", "Nothing to propose.", []);

    expect(await t.core.needsYou()).toEqual({ topicsToApprove: [], suggestedEdits: [], failedSources: [], total: 0 });
  });

  it("lists Sources with Topics to approve and failed Sources, newest first, with a total", async () => {
    const t = await createTestCore();
    t.clock.set(new Date("2026-03-01T10:00:00Z"));
    const kafka = await addNoteProposing(t, "Kafka notes", "Partitions and offsets.", ["Partitions", "Offsets"]);
    t.clock.set(new Date("2026-03-02T10:00:00Z"));
    t.contentFetcher.scriptArticleFailure("https://blog.example.com/raft", "The page could not be read.");
    const blog = await t.core.addSource({ kind: "url", url: "https://blog.example.com/raft" });
    await t.core.runJobs();
    t.clock.set(new Date("2026-03-03T10:00:00Z"));
    const raft = await addNoteProposing(t, "Raft notes", "Leaders and terms.", ["Leader election"]);

    expect(await t.core.needsYou()).toEqual({
      topicsToApprove: [
        { source: { id: raft.note.id, name: "Raft notes" }, count: 1 },
        { source: { id: kafka.note.id, name: "Kafka notes" }, count: 2 },
      ],
      suggestedEdits: [],
      failedSources: [
        { source: { id: blog.id, name: "https://blog.example.com/raft" }, failureReason: "The page could not be read." },
      ],
      total: 4,
    });
  });

  it("lists Topics with pending Suggested Edits and counts each edit", async () => {
    const t = await createTestCore();
    const explainer = ({ passages }: GenerateExplainerInput) => ({
      form: "infographic",
      title: "Consumer groups",
      keyPoints: [{ id: "kp1", text: "One consumer per partition.", citations: [{ chunkId: passages[0]!.chunkId }] }],
      analogy: null,
      diagram: { groups: [], nodes: [], edges: [] },
      steps: [],
    });
    const edit = ({ passages }: SuggestEditsInput) => [
      { kind: "adds", summary: "Adds static membership.", keyPointId: null, text: "Static membership.", citations: [{ chunkId: passages[0]!.chunkId }] },
    ];
    t.ai.scriptExplainer("Consumer groups", explainer);
    const first = await addNoteProposing(t, "Kafka notes", "Each partition has one consumer.", ["Consumer groups"]);
    const topic = await t.core.approveTopic({ proposalId: first.proposals[0]!.id });
    await t.core.runJobs();
    t.ai.scriptSuggestedEdits("Consumer groups", edit);
    const second = await addNoteProposing(t, "Rebalancing", "Static membership avoids rebalances.", ["Consumer groups"]);
    await t.core.approveTopic({ proposalId: second.proposals[0]!.id });
    await t.core.runJobs();

    const needs = await t.core.needsYou();
    expect(needs.suggestedEdits).toEqual([{ topic: { id: topic.id, name: "Consumer groups" }, count: 1 }]);
    expect(needs.total).toBe(1);
  });
});
