import type { ExplainerContent, ExplainerDraft, ExplainerStep } from "../explainer-content";

/**
 * AI adapter: every model call the core makes goes through here.
 * Real implementation: src/adapters/openai.ts. Fake: src/adapters/fakes/fake-ai.ts.
 *
 * Later tickets add operations here as they need them (generate an Explainer, apply an
 * instruction, Suggested Edits, reconcile Recall Prompts, grade an answer, transcribe
 * audio). Keep each one a single, typed call, and add it to the fake too.
 */
export interface AiAdapter {
  /** One embedding vector (EMBEDDING_DIMENSIONS long) per input text, in the same order. */
  embed(texts: string[]): Promise<number[][]>;

  /** The Topics a Source covers, each a short name and a one-line description. */
  proposeTopics(input: ProposeTopicsInput): Promise<TopicCandidate[]>;

  /**
   * Which of `existing` (the nearest Topics by embedding) is the same Topic as `candidate`,
   * or null if none is. Must return one of the given ids or null.
   */
  confirmTopicMatch(input: ConfirmTopicMatchInput): Promise<string | null>;

  /**
   * A first Explainer for a Topic, built only from these Source passages. Every citation must
   * name one of the given passages' chunkIds. The core validates the result before saving it,
   * so returning something malformed is safe (it is rejected), just wasteful.
   */
  generateExplainer(input: GenerateExplainerInput): Promise<ExplainerDraft>;

  /**
   * Animation steps that walk a learner through an existing Explainer's diagram, in order.
   * Each step highlights some of the diagram's node/edge ids with a caption. Used when an
   * Explainer that has no steps is switched to the animation form. Validated by the core.
   */
  generateExplainerSteps(input: GenerateExplainerStepsInput): Promise<ExplainerStep[]>;

  /**
   * Recall Prompts for a Topic, from its current Explainer: a mix of all four kinds, each with
   * the key points a good answer covers (taken from the Explainer). The core validates them.
   */
  generateRecallPrompts(input: GenerateRecallPromptsInput): Promise<RecallPromptDraft[]>;

  /**
   * The Explainer changed: judge the Topic's generated Recall Prompts against its new current
   * version. `keep` names the prompts (by id) that still fit; every other one is retired.
   * `add` holds new prompts for content no kept or learner prompt covers. Validated by the core.
   */
  reconcileRecallPrompts(input: ReconcileRecallPromptsInput): Promise<RecallPromptReconciliation>;

  /**
   * A new Source was linked to a Topic that already has an Explainer (ADR 0001: it is never
   * regenerated). Propose Suggested Edits: changes to the Explainer's key points that the new
   * Source's passages add or contradict. Each either adds a key point (`keyPointId` null) or
   * rewrites the named one, and cites the given passages. Often none. Validated by the core.
   */
  suggestEdits(input: SuggestEditsInput): Promise<SuggestedEditDraft[]>;
}

export interface SuggestEditsInput {
  topic: { name: string; description: string | null };
  /** The Explainer as the learner studies it now. */
  explainer: ExplainerContent;
  /** The new Source and its passages most relevant to the Topic. */
  source: { title: string | null };
  passages: ExplainerPassage[];
}

export interface SuggestedEditDraft {
  /** Whether the new Source adds to the Explainer or contradicts it. */
  kind: "adds" | "contradicts";
  /** One sentence for the learner: what the Source adds or contradicts. */
  summary: string;
  /** The key point to rewrite, or null to add a new key point. */
  keyPointId: string | null;
  /** The proposed key point text. */
  text: string;
  /** The passages (of those given) the proposed text comes from. */
  citations: { chunkId: string }[];
}

export interface ReconcileRecallPromptsInput {
  topic: { name: string; description: string | null };
  /** The Explainer's new current version. */
  explainer: ExplainerContent;
  /** The generated prompts to judge (active or paused). */
  prompts: (RecallPromptDraft & { id: string })[];
  /** The learner's own prompts (edited or written): never changed, shown so new prompts don't repeat them. */
  learnerPrompts: RecallPromptDraft[];
}

export interface RecallPromptReconciliation {
  /** Ids of the prompts that still fit. */
  keep: string[];
  /** New prompts for content that is not covered yet. */
  add: RecallPromptDraft[];
}

export interface GenerateExplainerStepsInput {
  topic: { name: string; description: string | null };
  content: ExplainerContent;
}

export type RecallPromptKind = "explain" | "compare" | "apply" | "why";

export interface GenerateRecallPromptsInput {
  topic: { name: string; description: string | null };
  explainer: ExplainerContent;
}

export interface RecallPromptDraft {
  kind: RecallPromptKind;
  question: string;
  expectedPoints: string[];
}

export interface GenerateExplainerInput {
  topic: { name: string; description: string | null };
  /** The passages to explain and cite, most relevant first. */
  passages: ExplainerPassage[];
}

export interface ExplainerPassage {
  chunkId: string;
  sourceTitle: string | null;
  text: string;
}

export interface ProposeTopicsInput {
  sourceTitle: string | null;
  text: string;
}

export interface TopicCandidate {
  name: string;
  description: string | null;
}

export interface ConfirmTopicMatchInput {
  candidate: TopicCandidate;
  existing: { id: string; name: string; description: string | null }[];
}

/** An AI call failed. `message` is safe to show the learner (e.g. as a Source's failure reason). */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}
