import type { RecallPromptKind } from "./ports/ai";

// Client-safe: no database imports.

/** The four kinds, in the order prompts are listed. */
export const RECALL_PROMPT_KINDS: readonly RecallPromptKind[] = ["explain", "compare", "apply", "why"];

export function recallPromptKindLabel(kind: RecallPromptKind): string {
  return { explain: "Explain", compare: "Compare", apply: "Apply", why: "Why" }[kind];
}
