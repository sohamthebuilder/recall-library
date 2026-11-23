import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { NotFoundError, ValidationError } from "./errors";
import { AiError } from "./ports/ai";
import { MAX_RECORDING_BYTES } from "./spoken-answers";

type TestCore = Awaited<ReturnType<typeof createTestCore>>;

/** A Topic (named after the question) with no Explainer and one Recall Prompt the learner wrote (due at once). */
async function promptToReview(t: TestCore, question = "Explain consumer groups") {
  const { created } = await t.core.importTopics(`Topic: ${question}`);
  return t.core.addRecallPrompt({ topicId: created[0]!.id, kind: "explain", question, expectedPoints: ["Partitions are shared out"] });
}

const recording = (text = "audio") => ({ bytes: new TextEncoder().encode(text), mimeType: "audio/webm" });

describe("a spoken answer", () => {
  it("is transcribed first, and the learner's corrected transcript is what gets graded", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const prompt = await promptToReview(t);
    const audio = recording("my answer, spoken");
    t.ai.scriptTranscription(audio.bytes, "  The group shares the partishuns out.  ");

    const { transcript } = await t.core.transcribeAnswer({ promptId: prompt.id, audio });

    expect(transcript).toBe("The group shares the partishuns out.");
    // Transcribing grades nothing and leaves the schedule alone.
    expect(t.ai.gradeRequests).toEqual([]);
    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.id)).toEqual([prompt.id]);

    const review = await t.core.submitReview({ promptId: prompt.id, answer: "The group shares the partitions out." });

    expect(t.ai.gradeRequests.map((r) => r.answer)).toEqual(["The group shares the partitions out."]);
    expect(review.answer).toBe("The group shares the partitions out.");
  });

  it("is transcribed with the question as a hint for the words to expect", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const prompt = await promptToReview(t, "Why does Kafka rebalance?");
    const audio = recording();

    await t.core.transcribeAnswer({ promptId: prompt.id, audio });

    expect(t.ai.transcriptionRequests).toEqual([{ audio, question: "Why does Kafka rebalance?" }]);
  });

  it("refuses an empty or too long recording without calling the AI", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const prompt = await promptToReview(t);

    await expect(t.core.transcribeAnswer({ promptId: prompt.id, audio: recording("") })).rejects.toThrow(ValidationError);
    const tooLong = { bytes: new Uint8Array(MAX_RECORDING_BYTES + 1), mimeType: "audio/webm" };
    await expect(t.core.transcribeAnswer({ promptId: prompt.id, audio: tooLong })).rejects.toThrow(ValidationError);
    expect(t.ai.transcriptionRequests).toEqual([]);
  });

  it("says so when nothing was heard", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const prompt = await promptToReview(t);
    const audio = recording("silence");
    t.ai.scriptTranscription(audio.bytes, "   ");

    await expect(t.core.transcribeAnswer({ promptId: prompt.id, audio })).rejects.toThrow(
      new ValidationError("No words were heard. Record again, or type your answer."),
    );
  });

  it("refuses a paused or deleted prompt, and passes on an AI failure with nothing graded", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const paused = await promptToReview(t, "Paused one");
    const deleted = await promptToReview(t, "Deleted one");
    const prompt = await promptToReview(t, "Live one");
    await t.core.suspendRecallPrompt(paused.id);
    await t.core.deleteRecallPrompt(deleted.id);
    const audio = recording("garbled");
    t.ai.scriptTranscriptionFailure(audio.bytes, "The AI service failed. Try again.");

    await expect(t.core.transcribeAnswer({ promptId: paused.id, audio })).rejects.toThrow(ValidationError);
    await expect(t.core.transcribeAnswer({ promptId: deleted.id, audio })).rejects.toThrow(NotFoundError);
    await expect(t.core.transcribeAnswer({ promptId: prompt.id, audio })).rejects.toThrow(new AiError("The AI service failed. Try again."));

    expect(t.ai.gradeRequests).toEqual([]);
    expect((await t.core.dueRecallPrompts()).prompts.map((p) => p.id)).toEqual([prompt.id]);
    // Recording again works.
    expect((await t.core.transcribeAnswer({ promptId: prompt.id, audio })).transcript).toMatch(/Spoken answer/);
  });
});
