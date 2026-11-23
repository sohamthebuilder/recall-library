import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { topics } from "@/db/schema";
import type { CoreDeps } from "./core";
import { ValidationError } from "./errors";
import { type ExplainerCitation, type ExplainerContent, validateExplainerContent, validateExplainerDraft } from "./explainer-content";
import { currentContent, STALE_EDIT } from "./explainer-editing";
import { citedPassages, type Explainer, getExplainer, saveExplainerVersion } from "./explainers";
import { AiError } from "./ports/ai";

/**
 * The learner reshaping an Explainer by telling the AI what they want (#19). The AI returns the
 * whole new Explainer; it is validated and saved as a new version (cause `instruction`), which
 * reconciles the Topic's Recall Prompts. A bad result changes nothing.
 */

export interface EditExplainerByInstructionInput {
  topicId: string;
  instruction: string;
  /** The version the learner was looking at; if the Explainer has moved on since, the instruction is refused. */
  baseVersionId?: string | null;
}

export const MAX_INSTRUCTION_LENGTH = 1000;
export const UNUSABLE_INSTRUCTION_RESULT =
  "The AI's version of the Explainer could not be used, so nothing was changed. Try rewording your instruction.";
export const INSTRUCTION_CHANGED_NOTHING = "The AI did not change anything for that instruction. Try rewording it.";

export async function editExplainerByInstruction(
  deps: CoreDeps,
  input: EditExplainerByInstructionInput,
): Promise<Explainer> {
  const instruction = input.instruction.trim();
  if (!instruction) throw new ValidationError("Say how you want the Explainer changed.");
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new ValidationError(`Keep the instruction under ${MAX_INSTRUCTION_LENGTH} characters.`);
  }
  const { explainerId, versionId, content } = await currentContent(deps, input.topicId);
  if (input.baseVersionId && input.baseVersionId !== versionId) throw new ValidationError(STALE_EDIT);

  const [topic] = await deps.db.select().from(topics).where(eq(topics.id, input.topicId));
  const passages = await citedPassages(deps.db, content);
  let draft: unknown;
  try {
    draft = await deps.ai.applyExplainerInstruction({
      topic: { name: topic!.name, description: topic!.description },
      instruction,
      explainer: content,
      passages: Object.values(passages).flatMap((p) =>
        p.status === "available" ? [{ chunkId: p.chunkId, sourceTitle: p.sourceTitle, text: p.text }] : [],
      ),
    });
  } catch (e) {
    if (e instanceof AiError) throw new ValidationError(e.message);
    throw e;
  }

  const next = withSources(draft, content);
  if (!next) throw new ValidationError(UNUSABLE_INSTRUCTION_RESULT);
  if (isDeepStrictEqual(next, content)) throw new ValidationError(INSTRUCTION_CHANGED_NOTHING);
  await deps.db.transaction((tx) =>
    saveExplainerVersion(tx, deps.clock.now(), {
      explainerId,
      content: next,
      cause: "instruction",
      causeDetail: { instruction },
    }),
  );
  return (await getExplainer(deps, input.topicId))!;
}

/**
 * The AI's draft as content, or null if it is unusable: malformed, or citing a passage the
 * current version does not cite (the AI may only keep, move or drop existing citations).
 */
function withSources(draft: unknown, current: ExplainerContent): ExplainerContent | null {
  const parsed = validateExplainerDraft(draft);
  if (!parsed.ok) return null;
  const known = new Map<string, ExplainerCitation>();
  for (const k of current.keyPoints) for (const c of k.citations) known.set(c.chunkId, c);
  const keyPoints = [];
  for (const k of parsed.value.keyPoints) {
    const citations = [];
    for (const c of k.citations) {
      const citation = known.get(c.chunkId);
      if (!citation) return null;
      citations.push(citation);
    }
    keyPoints.push({ ...k, citations });
  }
  const content = validateExplainerContent({ ...parsed.value, keyPoints });
  return content.ok ? content.value : null;
}
