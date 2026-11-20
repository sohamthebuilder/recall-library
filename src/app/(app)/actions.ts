"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLearner } from "@/auth";
import { NotFoundError, type UploadedFile, ValidationError } from "@/core";
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

/** Thin adapter from the link form to `addSource`. */
export async function addUrl(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const state = await attempt(() =>
    getCore().addSource({
      kind: "url",
      title: String(formData.get("title") ?? ""),
      url: String(formData.get("url") ?? ""),
    }),
  );
  if (state.ok) {
    runJobsAfterResponse();
    revalidatePath("/");
  }
  return state;
}

/** The uploaded file from a form's `file` field, as the core takes it (empty if none was chosen). */
async function uploadedFile(formData: FormData): Promise<UploadedFile> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { name: "", bytes: new Uint8Array() };
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Upload a .md file as a Source. Size and type rules live in the core. */
export async function uploadMarkdown(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const file = await uploadedFile(formData);
  const state = await attempt(() => getCore().addSource({ kind: "markdown", file }));
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

export type ImportTopicsState = FormState & { message: string | null };

/** Thin adapter from the paste-a-list form to `importTopics`. */
export async function importTopics(_prev: ImportTopicsState, formData: FormData): Promise<ImportTopicsState> {
  await requireLearner();
  let message: string | null = null;
  const state = await attempt(async () => {
    const { created, skipped } = await getCore().importTopics(String(formData.get("list") ?? ""));
    message = `Added ${created.length} Topic${created.length === 1 ? "" : "s"}.`;
    if (skipped.length) message += ` Skipped ${skipped.length} already in your Library: ${skipped.join(", ")}.`;
  });
  revalidatePath("/topics");
  return { ...state, message };
}

/** Link an existing Source to a Topic by hand (an approved link). */
export async function linkSourceToTopic(topicId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const sourceId = String(formData.get("sourceId") ?? "");
  const state = await attempt(async () => {
    if (!sourceId) throw new ValidationError("Choose a Source to link.");
    await getCore().linkSourceToTopic({ topicId, sourceId });
  });
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
  return state;
}
