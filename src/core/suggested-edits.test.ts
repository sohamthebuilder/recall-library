import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";
import type { GenerateExplainerInput, SuggestEditsInput } from "./ports/ai";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

const TOPIC = "Kafka consumer groups";
const FIRST_TEXT = "In a consumer group each partition is read by exactly one consumer.";
const SECOND_TEXT = "Consumers in a group rebalance when one joins or leaves; static membership avoids needless rebalances.";

function draft({ passages }: GenerateExplainerInput) {
  return {
    form: "infographic",
    title: "Consumer groups",
    keyPoints: [
      { id: "kp1", text: "Each partition is read by one consumer in a group.", citations: [{ chunkId: passages[0]!.chunkId }] },
      { id: "kp2", text: "Adding consumers never pauses reading.", citations: [{ chunkId: passages[0]!.chunkId }] },
    ],
    analogy: null,
    diagram: { groups: [], nodes: [{ id: "n1", label: "Partition", groupId: null }], edges: [] },
    steps: [],
  };
}

/** Two Suggested Edits from the new Source: one adds a key point, one contradicts kp2. */
function twoEdits({ passages }: SuggestEditsInput) {
  return [
    {
      kind: "adds",
      summary: "Adds static membership.",
      keyPointId: null,
      text: "Static membership avoids needless rebalances.",
      citations: [{ chunkId: passages[0]!.chunkId }],
    },
    {
      kind: "contradicts",
      summary: "The new Source says reading pauses while the group rebalances.",
      keyPointId: "kp2",
      text: "Adding a consumer triggers a rebalance, which briefly pauses reading.",
      citations: [{ chunkId: passages[0]!.chunkId }],
    },
  ];
}

async function topicWithExplainer(t: TestCore) {
  t.ai.scriptTopicProposals(FIRST_TEXT, [{ name: TOPIC, description: null }]);
  t.ai.scriptExplainer(TOPIC, draft);
  const note = await t.core.addSource({ kind: "note", title: "Kafka notes", text: FIRST_TEXT });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(note.id);
  const topic = await t.core.approveTopic({ proposalId: proposal!.id });
  await t.core.runJobs();
  return topic;
}

/** Add a second Source proposing the same Topic and approve the link. */
async function linkNewSource(t: TestCore, topicId: string) {
  t.ai.scriptTopicProposals(SECOND_TEXT, [{ name: TOPIC, description: null }]);
  const source = await t.core.addSource({ kind: "note", title: "Rebalancing", text: SECOND_TEXT });
  await t.core.runJobs();
  const [proposal] = await t.core.topicProposals(source.id);
  const linked = await t.core.approveTopic({ proposalId: proposal!.id });
  expect(linked.id).toBe(topicId);
  await t.core.runJobs();
  return source;
}

describe("Suggested Edits from a new Source", () => {
  it("linking a new Source to a Topic with an Explainer brings Suggested Edits and no new version", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);

    const source = await linkNewSource(t, topic.id);

    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
    expect(t.ai.explainerRequests).toHaveLength(1);
    const edits = await t.core.suggestedEdits(topic.id);
    expect(edits.map((e) => ({ ...e, id: undefined, createdAt: undefined, passages: undefined }))).toEqual([
      {
        id: undefined,
        topicId: topic.id,
        source: { id: source.id, title: "Rebalancing" },
        kind: "adds",
        summary: "Adds static membership.",
        keyPointId: null,
        currentText: null,
        proposedText: "Static membership avoids needless rebalances.",
        createdAt: undefined,
        passages: undefined,
      },
      {
        id: undefined,
        topicId: topic.id,
        source: { id: source.id, title: "Rebalancing" },
        kind: "contradicts",
        summary: "The new Source says reading pauses while the group rebalances.",
        keyPointId: "kp2",
        currentText: "Adding consumers never pauses reading.",
        proposedText: "Adding a consumer triggers a rebalance, which briefly pauses reading.",
        createdAt: undefined,
        passages: undefined,
      },
    ]);
    expect(edits[0]!.passages).toEqual([
      expect.objectContaining({ status: "available", sourceId: source.id, text: SECOND_TEXT }),
    ]);
  });

  it("accepting one applies it to the learner's edited Explainer as a new version, keeping their edits, and reconciles Recall Prompts", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const topic = await topicWithExplainer(t);
    await t.core.editExplainerText({
      topicId: topic.id,
      title: "My consumer groups",
      keyPoints: [
        { id: "kp1", text: "One partition, one consumer." },
        { id: "kp2", text: "Adding consumers never pauses reading." },
      ],
    });
    const edited = (await t.core.explainer(topic.id))!.current!;
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    const source = await linkNewSource(t, topic.id);
    const [adds, contradicts] = await t.core.suggestedEdits(topic.id);
    const reconciliationsBefore = t.ai.reconciliationRequests.length;
    t.clock.set(new Date("2026-03-02T10:00:00Z"));

    await t.core.acceptSuggestedEdit(adds!.id);
    await t.core.runJobs();

    const v3 = (await t.core.explainer(topic.id))!.current!;
    expect(v3).toMatchObject({ number: 3, cause: "suggested_edit", createdAt: new Date("2026-03-02T10:00:00Z") });
    const newChunk = adds!.passages[0]!.chunkId;
    expect(v3.content).toEqual({
      ...edited.content,
      keyPoints: [
        ...edited.content.keyPoints,
        { id: "kp3", text: "Static membership avoids needless rebalances.", citations: [{ chunkId: newChunk, sourceId: source.id }] },
      ],
    });
    expect(t.ai.reconciliationRequests).toHaveLength(reconciliationsBefore + 1);
    expect(t.ai.reconciliationRequests.at(-1)!.explainer).toEqual(v3.content);
    expect((await t.core.suggestedEdits(topic.id)).map((e) => e.id)).toEqual([contradicts!.id]);

    await t.core.acceptSuggestedEdit(contradicts!.id);

    const v4 = (await t.core.explainer(topic.id))!.current!;
    expect(v4.content).toEqual({
      ...v3.content,
      keyPoints: [
        v3.content.keyPoints[0],
        {
          id: "kp2",
          text: "Adding a consumer triggers a rebalance, which briefly pauses reading.",
          citations: [...v3.content.keyPoints[1]!.citations, { chunkId: newChunk, sourceId: source.id }],
        },
        v3.content.keyPoints[2],
      ],
    });
    expect(await t.core.suggestedEdits(topic.id)).toEqual([]);
  });

  it("rejecting one changes nothing in the Explainer", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);
    const before = (await t.core.explainer(topic.id))!;
    const [adds, contradicts] = await t.core.suggestedEdits(topic.id);
    const reconciliationsBefore = t.ai.reconciliationRequests.length;

    await t.core.rejectSuggestedEdit(contradicts!.id);
    await t.core.runJobs();

    expect(await t.core.explainer(topic.id)).toEqual(before);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
    expect(t.ai.reconciliationRequests).toHaveLength(reconciliationsBefore);
    expect((await t.core.suggestedEdits(topic.id)).map((e) => e.id)).toEqual([adds!.id]);
  });

  it("Topics with pending Suggested Edits are flagged in the Topic list until each is decided", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    expect(await t.core.pendingSuggestedEditCounts()).toEqual({});
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);

    expect(await t.core.pendingSuggestedEditCounts()).toEqual({ [topic.id]: 2 });
    const [adds, contradicts] = await t.core.suggestedEdits(topic.id);
    await t.core.acceptSuggestedEdit(adds!.id);
    expect(await t.core.pendingSuggestedEditCounts()).toEqual({ [topic.id]: 1 });
    await t.core.rejectSuggestedEdit(contradicts!.id);
    expect(await t.core.pendingSuggestedEditCounts()).toEqual({});
  });

  it("a Suggested Edit can be decided only once, and an unknown one is not found", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);
    const [adds, contradicts] = await t.core.suggestedEdits(topic.id);
    await t.core.acceptSuggestedEdit(adds!.id);
    await t.core.rejectSuggestedEdit(contradicts!.id);

    await expect(t.core.acceptSuggestedEdit(adds!.id)).rejects.toThrow(ValidationError);
    await expect(t.core.acceptSuggestedEdit(contradicts!.id)).rejects.toThrow(ValidationError);
    await expect(t.core.rejectSuggestedEdit(adds!.id)).rejects.toThrow(ValidationError);
    await expect(t.core.rejectSuggestedEdit("not-an-id")).rejects.toThrow(NotFoundError);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([2, 1]);
  });

  it("accepting an edit to a key point the learner has since removed is refused and saves nothing", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);
    const [, contradicts] = await t.core.suggestedEdits(topic.id);
    await t.core.editExplainerText({ topicId: topic.id, keyPoints: [{ id: "kp1", text: "Only this point." }] });

    expect((await t.core.suggestedEdits(topic.id))[1]).toMatchObject({ keyPointId: "kp2", currentText: null });
    await expect(t.core.acceptSuggestedEdit(contradicts!.id)).rejects.toThrow(ValidationError);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([2, 1]);
    await t.core.rejectSuggestedEdit(contradicts!.id);
  });

  it("drafts that are malformed, cite passages they were not given or name an unknown key point are dropped", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, ({ passages }) => {
      const cite = [{ chunkId: passages[0]!.chunkId }];
      return [
        { kind: "adds", summary: "  Fine. ", keyPointId: null, text: " Kept. ", citations: cite },
        { kind: "rewrites", summary: "Bad kind.", keyPointId: null, text: "x", citations: cite },
        { kind: "adds", summary: "", keyPointId: null, text: "No summary.", citations: cite },
        { kind: "adds", summary: "No text.", keyPointId: null, text: "  ", citations: cite },
        { kind: "contradicts", summary: "Unknown point.", keyPointId: "kp9", text: "x", citations: cite },
        { kind: "adds", summary: "Cites nothing.", keyPointId: null, text: "x", citations: [] },
        { kind: "adds", summary: "Cites another chunk.", keyPointId: null, text: "x", citations: [{ chunkId: "other" }] },
      ];
    });

    await linkNewSource(t, topic.id);

    expect((await t.core.suggestedEdits(topic.id)).map((e) => [e.summary, e.proposedText])).toEqual([["Fine.", "Kept."]]);
  });

  it("an AI failure brings no Suggested Edits and no new version", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEditsFailure(TOPIC, "The AI is down.");

    await linkNewSource(t, topic.id);

    expect(await t.core.suggestedEdits(topic.id)).toEqual([]);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("an AI failure is shown on the Topic, and checking the Source again brings its Suggested Edits", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEditsFailure(TOPIC, "The AI is down.");
    const source = await linkNewSource(t, topic.id);

    expect(await t.core.suggestedEditFailures(topic.id)).toEqual([
      { source: { id: source.id, title: "Rebalancing" }, reason: "The AI is down." },
    ]);

    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await t.core.retrySuggestedEdits({ topicId: topic.id, sourceId: source.id });
    await t.core.runJobs();

    expect(await t.core.suggestedEditFailures(topic.id)).toEqual([]);
    expect(await t.core.suggestedEdits(topic.id)).toHaveLength(2);
    // Only a failed check can be retried.
    await expect(t.core.retrySuggestedEdits({ topicId: topic.id, sourceId: source.id })).rejects.toThrow(ValidationError);
  });

  it("accepting or rejecting one twice at once decides it once", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);
    const [adds, contradicts] = await t.core.suggestedEdits(topic.id);

    const accepts = await Promise.allSettled([t.core.acceptSuggestedEdit(adds!.id), t.core.acceptSuggestedEdit(adds!.id)]);
    const rejects = await Promise.allSettled([
      t.core.rejectSuggestedEdit(contradicts!.id),
      t.core.acceptSuggestedEdit(contradicts!.id),
    ]);

    expect(accepts.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(rejects.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect([...accepts, ...rejects].filter((r) => r.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.any(ValidationError) }),
      expect.objectContaining({ reason: expect.any(ValidationError) }),
    ]);
    const versions = (await t.core.explainerVersions(topic.id)).length;
    expect(versions === 2 || versions === 3).toBe(true);
    const current = (await t.core.explainer(topic.id))!.current!.content.keyPoints;
    expect(current.filter((k) => k.text === "Static membership avoids needless rebalances.")).toHaveLength(1);
  });

  it("a malformed Topic id is not found", async () => {
    const t = await createTestCore();
    await expect(t.core.suggestedEdits("not-a-uuid")).rejects.toThrow(NotFoundError);
    await expect(t.core.suggestedEditFailures("not-a-uuid")).rejects.toThrow(NotFoundError);
  });

  it("a Source linked by hand before it has text brings Suggested Edits once its text is captured", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    const url = "https://blog.example.com/rebalancing";
    t.contentFetcher.scriptArticleFailure(url, "Site down.");
    const source = await t.core.addSource({ kind: "url", url });
    await t.core.linkSourceToTopic({ topicId: topic.id, sourceId: source.id });
    await t.core.runJobs();
    expect(await t.core.suggestedEdits(topic.id)).toEqual([]);

    t.contentFetcher.scriptArticle(url, { title: "Rebalancing", text: SECOND_TEXT });
    await t.core.retrySource(source.id);
    await t.core.runJobs();

    expect((await t.core.suggestedEdits(topic.id)).map((e) => e.source)).toEqual([
      { id: source.id, title: "Rebalancing" },
      { id: source.id, title: "Rebalancing" },
    ]);
    expect(t.ai.suggestEditsRequests).toHaveLength(1);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("a Source linked while the first Explainer is being made is part of it and brings no Suggested Edits", async () => {
    const t = await createTestCore();
    t.ai.scriptTopicProposals(FIRST_TEXT, [{ name: TOPIC, description: null }]);
    t.ai.scriptTopicProposals(SECOND_TEXT, [{ name: TOPIC, description: null }]);
    const first = await t.core.addSource({ kind: "note", title: "Kafka notes", text: FIRST_TEXT });
    const second = await t.core.addSource({ kind: "note", title: "Rebalancing", text: SECOND_TEXT });
    await t.core.runJobs();
    const topic = await t.core.approveTopic({ proposalId: (await t.core.topicProposals(first.id))[0]!.id });
    await t.core.mergeTopic({ proposalId: (await t.core.topicProposals(second.id))[0]!.id, intoTopicId: topic.id });
    await t.core.runJobs();

    expect(t.ai.explainerRequests).toHaveLength(1);
    expect(t.ai.suggestEditsRequests).toHaveLength(0);
    expect((await t.core.explainerVersions(topic.id)).map((v) => v.number)).toEqual([1]);
  });

  it("deleting the Source removes its pending Suggested Edits", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    const source = await linkNewSource(t, topic.id);

    await t.core.deleteSource(source.id);

    expect(await t.core.suggestedEdits(topic.id)).toEqual([]);
    expect(await t.core.pendingSuggestedEditCounts()).toEqual({});
  });

  it("the comparison view shows key points from accepted Suggested Edits as suggested, not as added by the learner", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);
    const [adds, contradicts] = await t.core.suggestedEdits(topic.id);
    await t.core.acceptSuggestedEdit(adds!.id);
    await t.core.acceptSuggestedEdit(contradicts!.id);
    await t.core.editExplainerText({
      topicId: topic.id,
      keyPoints: [
        { id: "kp1", text: "Each partition is read by one consumer in a group." },
        { id: "kp2", text: "Adding a consumer triggers a rebalance, which briefly pauses reading." },
        { id: "kp3", text: "Static membership: fewer rebalances." },
        { text: "My own point." },
      ],
    });

    expect(
      (await t.core.explainerComparison(topic.id)).map(({ keyPointId, origin, generatedText, edited }) => ({
        keyPointId,
        origin,
        generatedText,
        edited,
      })),
    ).toEqual([
      { keyPointId: "kp1", origin: "generated", generatedText: "Each partition is read by one consumer in a group.", edited: false },
      {
        keyPointId: "kp2",
        origin: "suggested_edit",
        generatedText: "Adding a consumer triggers a rebalance, which briefly pauses reading.",
        edited: false,
      },
      { keyPointId: "kp3", origin: "suggested_edit", generatedText: "Static membership avoids needless rebalances.", edited: true },
      { keyPointId: "kp4", origin: "learner", generatedText: null, edited: true },
    ]);
  });

  it("restoring a version keeps where its key points came from", async () => {
    const t = await createTestCore();
    const topic = await topicWithExplainer(t);
    t.ai.scriptSuggestedEdits(TOPIC, twoEdits);
    await linkNewSource(t, topic.id);
    const [adds] = await t.core.suggestedEdits(topic.id);
    await t.core.acceptSuggestedEdit(adds!.id);
    const withSuggestion = (await t.core.explainer(topic.id))!.current!;
    await t.core.editExplainerText({ topicId: topic.id, keyPoints: [{ id: "kp1", text: "Just one." }] });
    await t.core.restoreExplainerVersion({ topicId: topic.id, versionId: withSuggestion.id });

    expect((await t.core.explainerComparison(topic.id)).map((r) => [r.keyPointId, r.origin])).toEqual([
      ["kp1", "generated"],
      ["kp2", "generated"],
      ["kp3", "suggested_edit"],
    ]);
  });
});
