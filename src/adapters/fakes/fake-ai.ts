import type { ExplainerDraft, ExplainerStep } from "@/core/explainer-content";
import {
  AiError,
  type AiAdapter,
  type ConfirmTopicMatchInput,
  type GenerateExplainerInput,
  type GenerateExplainerStepsInput,
  type GenerateRecallPromptsInput,
  type ProposeTopicsInput,
  type RecallPromptDraft,
  type TopicCandidate,
} from "@/core/ports/ai";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";

export const FAKE_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;

type Scripted<T> = T | (() => T | Promise<T>);

/**
 * Deterministic AI fake. Script it per test; anything unscripted gets a stable default,
 * never a network call:
 * - embed: a vector derived from the text (scriptEmbedding to choose one; short vectors are
 *   zero-padded, so `[1, 0]` and `[0.9, 0.1]` are fine)
 * - proposeTopics: no Topics (scriptTopicProposals, keyed by the Source's exact text)
 * - confirmTopicMatch: no match (scriptTopicMatch, keyed by candidate name)
 * - generateExplainer: a small valid infographic titled after the Topic, one key point per
 *   passage (up to 3) citing it (scriptExplainer / scriptExplainerFailure, keyed by Topic name)
 * - generateExplainerSteps: one step per diagram node (scriptExplainerSteps /
 *   scriptExplainerStepsFailure, keyed by Topic name)
 * - generateRecallPrompts: one prompt of each kind, expecting the Explainer's first key point
 *   (scriptRecallPrompts / scriptRecallPromptsFailure, keyed by Topic name)
 */
export class FakeAi implements AiAdapter {
  private readonly scriptedEmbeddings = new Map<string, number[]>();
  private readonly scriptedProposals = new Map<string, Scripted<TopicCandidate[]>>();
  private readonly proposalFailures = new Map<string, string[]>();
  private readonly scriptedMatches = new Map<string, string | null>();
  private readonly scriptedExplainers = new Map<string, ExplainerScript>();
  private readonly explainerFailures = new Map<string, string[]>();

  private readonly scriptedSteps = new Map<string, StepsScript>();
  private readonly stepsFailures = new Map<string, string[]>();
  private readonly scriptedRecallPrompts = new Map<string, RecallPromptsScript>();
  private readonly recallPromptFailures = new Map<string, string[]>();

  /** Every generateRecallPrompts call, in order. */
  readonly recallPromptRequests: GenerateRecallPromptsInput[] = [];

  /** Every generateExplainer call, in order. */
  readonly explainerRequests: GenerateExplainerInput[] = [];

  /** Every generateExplainerSteps call, in order. */
  readonly stepsRequests: GenerateExplainerStepsInput[] = [];

  /** Every confirmTopicMatch call, in order: which existing Topics were offered for which candidate. */
  readonly matchRequests: ConfirmTopicMatchInput[] = [];
  /** Every `proposeTopics` call, in order. */
  readonly proposalRequests: ProposeTopicsInput[] = [];

  /** Make `embed` return this vector for this exact text. */
  scriptEmbedding(text: string, vector: number[]): this {
    this.scriptedEmbeddings.set(text, pad(vector));
    return this;
  }

  /** Make `proposeTopics` return these Topics for a Source with exactly this text. */
  scriptTopicProposals(
    text: string,
    proposals: TopicCandidate[] | (() => TopicCandidate[] | Promise<TopicCandidate[]>),
  ): this {
    this.scriptedProposals.set(text, proposals);
    return this;
  }

  /** Make the next `proposeTopics` call for this text fail with this reason (then it behaves as scripted). */
  scriptTopicProposalFailure(text: string, reason: string): this {
    this.proposalFailures.set(text, [...(this.proposalFailures.get(text) ?? []), reason]);
    return this;
  }

  /**
   * Make `confirmTopicMatch` say the candidate with this name is the existing Topic named
   * `existingTopicName` (if that Topic was among those offered), or explicitly no match (null).
   */
  scriptTopicMatch(candidateName: string, existingTopicName: string | null): this {
    this.scriptedMatches.set(candidateName, existingTopicName);
    return this;
  }

  /**
   * Make `generateExplainer` for the Topic with this name return this draft (or what the
   * function builds from the request, e.g. to cite `passages[0].chunkId`). Need not be valid.
   */
  scriptExplainer(topicName: string, draft: ExplainerScript): this {
    this.scriptedExplainers.set(topicName, draft);
    return this;
  }

  /** Make the next `generateExplainer` call for this Topic fail with this reason (then it behaves as scripted). */
  scriptExplainerFailure(topicName: string, reason: string): this {
    this.explainerFailures.set(topicName, [...(this.explainerFailures.get(topicName) ?? []), reason]);
    return this;
  }

  async generateExplainer(input: GenerateExplainerInput): Promise<ExplainerDraft> {
    this.explainerRequests.push(input);
    const failure = this.explainerFailures.get(input.topic.name)?.shift();
    if (failure !== undefined) throw new AiError(failure);
    const scripted = this.scriptedExplainers.get(input.topic.name);
    if (scripted === undefined) return defaultExplainer(input);
    return (typeof scripted === "function" ? await scripted(input) : scripted) as ExplainerDraft;
  }

  /**
   * Make `generateExplainerSteps` for the Topic with this name return these steps (or what the
   * function builds from the request). Need not be valid.
   */
  scriptExplainerSteps(topicName: string, steps: StepsScript): this {
    this.scriptedSteps.set(topicName, steps);
    return this;
  }

  /** Make the next `generateExplainerSteps` call for this Topic fail with this reason. */
  scriptExplainerStepsFailure(topicName: string, reason: string): this {
    this.stepsFailures.set(topicName, [...(this.stepsFailures.get(topicName) ?? []), reason]);
    return this;
  }

  async generateExplainerSteps(input: GenerateExplainerStepsInput): Promise<ExplainerStep[]> {
    this.stepsRequests.push(input);
    const failure = this.stepsFailures.get(input.topic.name)?.shift();
    if (failure !== undefined) throw new AiError(failure);
    const scripted = this.scriptedSteps.get(input.topic.name);
    if (scripted === undefined) return defaultSteps(input);
    return (typeof scripted === "function" ? await scripted(input) : scripted) as ExplainerStep[];
  }

  /** Make `generateRecallPrompts` for the Topic with this name return these (or what the function builds). Need not be valid. */
  scriptRecallPrompts(topicName: string, prompts: RecallPromptsScript): this {
    this.scriptedRecallPrompts.set(topicName, prompts);
    return this;
  }

  /** Make the next `generateRecallPrompts` call for this Topic fail with this reason (then it behaves as scripted). */
  scriptRecallPromptsFailure(topicName: string, reason: string): this {
    this.recallPromptFailures.set(topicName, [...(this.recallPromptFailures.get(topicName) ?? []), reason]);
    return this;
  }

  async generateRecallPrompts(input: GenerateRecallPromptsInput): Promise<RecallPromptDraft[]> {
    this.recallPromptRequests.push(input);
    const failure = this.recallPromptFailures.get(input.topic.name)?.shift();
    if (failure !== undefined) throw new AiError(failure);
    const scripted = this.scriptedRecallPrompts.get(input.topic.name);
    if (scripted === undefined) return defaultRecallPrompts(input);
    return (typeof scripted === "function" ? await scripted(input) : scripted) as RecallPromptDraft[];
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.scriptedEmbeddings.get(t) ?? defaultEmbedding(t));
  }

  async proposeTopics(input: ProposeTopicsInput): Promise<TopicCandidate[]> {
    this.proposalRequests.push(input);
    const { text } = input;
    const failure = this.proposalFailures.get(text)?.shift();
    if (failure !== undefined) throw new AiError(failure);
    const scripted = this.scriptedProposals.get(text);
    if (!scripted) return [];
    return typeof scripted === "function" ? await scripted() : scripted;
  }

  async confirmTopicMatch(input: ConfirmTopicMatchInput): Promise<string | null> {
    this.matchRequests.push(input);
    const name = this.scriptedMatches.get(input.candidate.name);
    if (!name) return null;
    return input.existing.find((t) => t.name === name)?.id ?? null;
  }
}

/** A draft, or a builder from the request. Typed loosely so tests can script invalid drafts. */
export type ExplainerScript =
  | ExplainerDraft
  | Record<string, unknown>
  | ((input: GenerateExplainerInput) => ExplainerDraft | Record<string, unknown> | Promise<ExplainerDraft | Record<string, unknown>>);

/** Steps, or a builder from the request. Typed loosely so tests can script invalid steps. */
export type StepsScript =
  | ExplainerStep[]
  | Record<string, unknown>[]
  | ((input: GenerateExplainerStepsInput) => unknown[] | Promise<unknown[]>);

/** One step per diagram node, in order, highlighting just that node. */
function defaultSteps({ content }: GenerateExplainerStepsInput): ExplainerStep[] {
  return content.diagram.nodes.map((n) => ({ caption: `Look at ${n.label}.`, highlight: { nodeIds: [n.id], edgeIds: [] } }));
}

function defaultExplainer({ topic, passages }: GenerateExplainerInput): ExplainerDraft {
  const cited = passages.slice(0, 3);
  return {
    form: "infographic",
    title: topic.name,
    keyPoints: cited.map((p, i) => ({
      id: `kp${i + 1}`,
      text: `Point ${i + 1} about ${topic.name}.`,
      citations: [{ chunkId: p.chunkId }],
    })),
    analogy: null,
    diagram: {
      groups: [],
      nodes: [{ id: "n1", label: topic.name, groupId: null }],
      edges: [],
    },
    steps: [],
  };
}

/** Drafts, or a builder from the request. Typed loosely so tests can script invalid ones. */
type LooseRecallPrompts = (RecallPromptDraft | Record<string, unknown>)[];
export type RecallPromptsScript =
  | LooseRecallPrompts
  | ((input: GenerateRecallPromptsInput) => LooseRecallPrompts | Promise<LooseRecallPrompts>);

function defaultRecallPrompts({ topic, explainer }: GenerateRecallPromptsInput): RecallPromptDraft[] {
  const expectedPoints = [explainer.keyPoints[0]?.text ?? topic.name];
  return [
    { kind: "explain", question: `Explain ${topic.name}.`, expectedPoints },
    { kind: "compare", question: `Compare ${topic.name} with an alternative.`, expectedPoints },
    { kind: "apply", question: `When would you use ${topic.name}?`, expectedPoints },
    { kind: "why", question: `Why does ${topic.name} work this way?`, expectedPoints },
  ];
}

function pad(vector: number[]): number[] {
  if (vector.length > FAKE_EMBEDDING_DIMENSIONS) throw new Error("FakeAi: embedding too long");
  return [...vector, ...new Array<number>(FAKE_EMBEDDING_DIMENSIONS - vector.length).fill(0)];
}

/** A stable unit vector from the text: similar only by accident, never identical for different text. */
function defaultEmbedding(text: string): number[] {
  const v = new Array<number>(FAKE_EMBEDDING_DIMENSIONS).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    v[(h >>> 0) % FAKE_EMBEDDING_DIMENSIONS]! += 1;
  }
  v[0]! += 1e-3; // never the zero vector, even for empty text
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}
