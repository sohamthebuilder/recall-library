/**
 * AI adapter: every model call the core makes goes through here.
 * Real implementation: OpenAI (added by later tickets). Fake: src/adapters/fakes/fake-ai.ts.
 *
 * Later tickets add operations here as they need them (propose Topics, match Topics,
 * generate an Explainer, apply an instruction, Suggested Edits, reconcile Recall Prompts,
 * grade an answer, transcribe audio). Keep each one a single, typed call.
 */
export interface AiAdapter {
  /** One embedding vector per input text, in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}
