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
