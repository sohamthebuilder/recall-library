"use server";

import { revalidatePath } from "next/cache";
import { requireLearner } from "@/auth";
import { AiError, NotFoundError, type RecallPromptKind, type Review, type ReviewRating, ValidationError } from "@/core";
import { getCore } from "@/server/core";
import type { FormState } from "../actions";

export type ReviewState = { error: string | null; review: Review | null };

async function attemptReview(op: () => Promise<Review>): Promise<ReviewState> {
  try {
    return { error: null, review: await op() };
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError || e instanceof AiError) {
      return { error: e.message, review: null };
    }
    throw e;
  }
}

/**
 * Grade a typed answer. Does not revalidate /review: the page keeps showing the grade
 * until the learner moves on (the client refreshes then).
 */
export async function submitAnswer(sessionId: string, promptId: string, _prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireLearner();
  return attemptReview(() => getCore().submitReview({ sessionId, promptId, answer: String(formData.get("answer") ?? "") }));
}

export type TranscriptState = { error: string | null; transcript: string | null };

/** Spoken answer: turn the recording into text for the learner to check and correct. Grades nothing. */
export async function transcribeSpokenAnswer(promptId: string, formData: FormData): Promise<TranscriptState> {
  await requireLearner();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) return { error: "No recording was received. Record again, or type your answer.", transcript: null };
  try {
    const { transcript } = await getCore().transcribeAnswer({
      promptId,
      audio: { bytes: new Uint8Array(await audio.arrayBuffer()), mimeType: audio.type || "audio/webm" },
    });
    return { error: null, transcript };
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError || e instanceof AiError) return { error: e.message, transcript: null };
    throw e;
  }
}

export async function overruleGrade(reviewId: string, rating: ReviewRating): Promise<ReviewState> {
  await requireLearner();
  const state = await attemptReview(() => getCore().overruleGrade({ reviewId, rating }));
  revalidatePath("/");
  return state;
}

// Changing the current prompt mid-Review (the session then moves on or shows the new wording).

export async function editPromptInReview(promptId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  try {
    await getCore().editRecallPrompt({
      promptId,
      kind: String(formData.get("kind") ?? "") as RecallPromptKind,
      question: String(formData.get("question") ?? ""),
      expectedPoints: String(formData.get("expectedPoints") ?? "").split(/\r?\n/),
    });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError) return { error: e.message, ok: false };
    throw e;
  }
  revalidatePath("/review");
  revalidatePath("/practice");
  return { error: null, ok: true };
}

export async function pausePromptInReview(promptId: string): Promise<void> {
  await requireLearner();
  await ignoreGone(() => getCore().suspendRecallPrompt(promptId));
  revalidatePath("/review");
  revalidatePath("/practice");
}

export async function deletePromptInReview(promptId: string): Promise<void> {
  await requireLearner();
  await ignoreGone(() => getCore().deleteRecallPrompt(promptId));
  revalidatePath("/review");
  revalidatePath("/practice");
}

async function ignoreGone(op: () => Promise<unknown>): Promise<void> {
  try {
    await op();
  } catch (e) {
    if (!(e instanceof ValidationError || e instanceof NotFoundError)) throw e;
  }
}
