import type { ExplainerContent, ExplainerDraft } from "../explainer-content";

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
   * Recall Prompts for a Topic, from its current Explainer: a mix of all four kinds, each with
   * the key points a good answer covers (taken from the Explainer). The core validates them.
   */
  generateRecallPrompts(input: GenerateRecallPromptsInput): Promise<RecallPromptDraft[]>;
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
