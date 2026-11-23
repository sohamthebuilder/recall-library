import type { CoreDeps } from "./core";
import { ValidationError } from "./errors";
import { MAX_RECORDING_BYTES } from "./recording-limits";
import { reviewablePrompt } from "./reviews";

/**
 * Spoken answers. The learner records an answer to a Recall Prompt; the AI turns it into
 * text, which the learner reads and corrects, then submits as an ordinary answer
 * (`submitReview`). Nothing is graded or rescheduled here, and Reviews don't know an answer
 * was spoken.
 */

export { MAX_RECORDING_BYTES };

export interface TranscribeAnswerInput {
  promptId: string;
  audio: { bytes: Uint8Array; mimeType: string };
}

export interface Transcript {
  promptId: string;
  transcript: string;
}

export async function transcribeAnswer(deps: CoreDeps, input: TranscribeAnswerInput): Promise<Transcript> {
  const { bytes } = input.audio;
  if (bytes.length === 0) throw new ValidationError("The recording is empty. Record again, or type your answer.");
  if (bytes.length > MAX_RECORDING_BYTES) {
    throw new ValidationError("The recording is too long. Keep it to a few minutes, or type your answer.");
  }
  const prompt = await reviewablePrompt(deps.db, input.promptId);
  const transcript = (await deps.ai.transcribeAnswer({ audio: input.audio, question: prompt.question })).trim();
  if (!transcript) throw new ValidationError("No words were heard. Record again, or type your answer.");
  return { promptId: prompt.id, transcript };
}
