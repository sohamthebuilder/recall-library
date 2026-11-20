import type { AiAdapter } from "@/core/ports/ai";

export const FAKE_EMBEDDING_DIMENSIONS = 8;

/**
 * Deterministic AI fake. Script it per test; anything unscripted gets a stable default
 * (embeddings derived from the text), never a network call.
 */
export class FakeAi implements AiAdapter {
  private readonly scriptedEmbeddings = new Map<string, number[]>();

  /** Make `embed` return this vector for this exact text. */
  scriptEmbedding(text: string, vector: number[]): this {
    this.scriptedEmbeddings.set(text, vector);
    return this;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.scriptedEmbeddings.get(t) ?? defaultEmbedding(t));
  }
}

function defaultEmbedding(text: string): number[] {
  const v = new Array<number>(FAKE_EMBEDDING_DIMENSIONS).fill(0);
  for (let i = 0; i < text.length; i++) {
    const slot = i % FAKE_EMBEDDING_DIMENSIONS;
    v[slot] = (v[slot]! + text.charCodeAt(i)) % 1000;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
