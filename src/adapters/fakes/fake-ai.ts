import { AiError, type AiAdapter, type ConfirmTopicMatchInput, type ProposeTopicsInput, type TopicCandidate } from "@/core/ports/ai";
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
 */
export class FakeAi implements AiAdapter {
  private readonly scriptedEmbeddings = new Map<string, number[]>();
  private readonly scriptedProposals = new Map<string, Scripted<TopicCandidate[]>>();
  private readonly proposalFailures = new Map<string, string[]>();
  private readonly scriptedMatches = new Map<string, string | null>();

  /** Every confirmTopicMatch call, in order: which existing Topics were offered for which candidate. */
  readonly matchRequests: ConfirmTopicMatchInput[] = [];

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

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.scriptedEmbeddings.get(t) ?? defaultEmbedding(t));
  }

  async proposeTopics({ text }: ProposeTopicsInput): Promise<TopicCandidate[]> {
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
