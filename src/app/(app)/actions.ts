"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLearner } from "@/auth";
import { NotFoundError, ValidationError } from "@/core";
import { getCore } from "@/server/core";
import { runJobsAfterResponse } from "@/server/jobs";

export type FormState = { error: string | null; ok: boolean };
export type AddNoteState = FormState;

/** Run one core operation for a form, turning domain errors into a message for the learner. */
async function attempt(op: () => Promise<unknown>): Promise<FormState> {
  try {
    await op();
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError) return { error: e.message, ok: false };
    throw e;
  }
  return { error: null, ok: true };
}

/** Thin adapter from the form to `addSource`; all rules live in the core. */
export async function addNote(_prev: AddNoteState, formData: FormData): Promise<AddNoteState> {
  await requireLearner();
  const state = await attempt(() =>
    getCore().addSource({
      kind: "note",
      title: String(formData.get("title") ?? ""),
      text: String(formData.get("text") ?? ""),
    }),
  );
  if (state.ok) {
    runJobsAfterResponse();
    revalidatePath("/");
  }
  return state;
}

export async function retrySource(sourceId: string): Promise<void> {
  await requireLearner();
  const state = await attempt(() => getCore().retrySource(sourceId));
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/sources/${sourceId}`);
  revalidatePath("/");
}

/** Approve (optionally renamed), merge into an existing Topic, or reject a proposed Topic. */
export async function decideTopicProposal(
  sourceId: string,
  proposalId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireLearner();
  const core = getCore();
  const decision = String(formData.get("decision") ?? "");
  const state = await attempt(async () => {
    if (decision === "approve") {
      const name = String(formData.get("name") ?? "").trim();
      const proposed = String(formData.get("proposedName") ?? "");
      await core.approveTopic({ proposalId, name: name && name !== proposed ? name : undefined });
    } else if (decision === "merge") {
      const intoTopicId = String(formData.get("intoTopicId") ?? "");
      if (!intoTopicId) throw new ValidationError("Choose the Topic to merge into.");
      await core.mergeTopic({ proposalId, intoTopicId });
    } else if (decision === "reject") {
      await core.rejectTopic(proposalId);
    } else {
      throw new ValidationError("Unknown decision.");
    }
  });
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/sources/${sourceId}`);
  revalidatePath("/topics");
  return state;
}

export async function retryExplainer(topicId: string): Promise<void> {
  await requireLearner();
  const state = await attempt(() => getCore().retryExplainer(topicId));
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/topics/${topicId}`);
}

export async function deleteTopic(topicId: string): Promise<void> {
  await requireLearner();
  try {
    await getCore().deleteTopic(topicId);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  revalidatePath("/topics");
  redirect("/topics");
}
