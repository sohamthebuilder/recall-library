import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import type { GenerateExplainerInput, SuggestEditsInput } from "./ports/ai";

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

describe("untitled Notes are named the same way everywhere", () => {
  it("in an Explainer's citations and in Suggested Edits", async () => {
    const t = await createTestCore();
    t.ai.scriptExplainer("Consumer groups", explainer);
    t.ai.scriptTopicProposals("# Partitions\nEach partition has one consumer.", [{ name: "Consumer groups", description: null }]);
    const first = await t.core.addSource({ kind: "note", text: "# Partitions\nEach partition has one consumer." });
    await t.core.runJobs();
    const topic = await t.core.approveTopic({ proposalId: (await t.core.topicProposals(first.id))[0]!.id });
    await t.core.runJobs();

    const passages = Object.values((await t.core.explainer(topic.id))!.passages);
    expect(passages).toEqual([expect.objectContaining({ sourceName: "Partitions" })]);

    t.ai.scriptSuggestedEdits("Consumer groups", edit);
    t.ai.scriptTopicProposals("Static membership avoids rebalances.", [{ name: "Consumer groups", description: null }]);
    const second = await t.core.addSource({ kind: "note", text: "Static membership avoids rebalances." });
    await t.core.runJobs();
    await t.core.approveTopic({ proposalId: (await t.core.topicProposals(second.id))[0]!.id });
    await t.core.runJobs();

    const [suggested] = await t.core.suggestedEdits(topic.id);
    expect(suggested!.source).toEqual({ id: second.id, title: null, name: "Static membership avoids rebalances." });
  });
});
