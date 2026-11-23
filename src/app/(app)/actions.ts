"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLearner } from "@/auth";
import { NotFoundError, type RecallPromptKind, type UploadedFile, ValidationError } from "@/core";
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

/** Quick add (home screen box and the Share menu): the core routes the link to the YouTube or blog URL flow. */
export async function addLink(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const state = await attempt(() => getCore().addLink({ text: String(formData.get("link") ?? "") }));
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

/**
 * Add a PDF the browser has already uploaded to the file store (see /api/uploads/pdf):
 * books are larger than a server action's request body allows, so the bytes never pass
 * through here. Type and size rules live in the core.
 */
export async function addUploadedPdf(upload: { key: string; name: string }): Promise<FormState & { sourceId?: string }> {
  await requireLearner();
  let sourceId: string | undefined;
  const state = await attempt(async () => {
    sourceId = (await getCore().addSource({ kind: "pdf", storedFile: { key: String(upload.key), name: String(upload.name) } })).id;
  });
  if (state.ok) {
    runJobsAfterResponse();
    revalidatePath("/");
  }
  return { ...state, sourceId };
}

/** Select chapters of a PDF to propose Topics from (checkboxes named `chapterId`). */
export async function selectChapters(sourceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const chapterIds = formData.getAll("chapterId").map(String);
  const state = await attempt(() => getCore().selectChapters({ sourceId, chapterIds }));
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/sources/${sourceId}`);
  revalidatePath("/");
  return state;
}

/** Thin adapter from the form to `addSource` for a YouTube link. */
export async function addYouTubeVideo(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const state = await attempt(() => getCore().addSource({ kind: "youtube", url: String(formData.get("url") ?? "") }));
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

/** Delete a Source (the learner has confirmed), then go back to the Library. */
export async function deleteSource(sourceId: string): Promise<void> {
  await requireLearner();
  try {
    await getCore().deleteSource(sourceId);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  revalidatePath("/");
  revalidatePath("/topics", "layout");
  redirect("/");
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

/** Put a Tag (by name) on a Topic. */
export async function tagTopic(topicId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const state = await attempt(() => getCore().tagTopic({ topicId, name: String(formData.get("name") ?? "") }));
  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
  return state;
}

/** Take a Tag off a Topic. */
export async function untagTopic(topicId: string, tagId: string): Promise<void> {
  await requireLearner();
  await attempt(() => getCore().untagTopic({ topicId, tagId }));
  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
}

export async function retryExplainer(topicId: string): Promise<void> {
  await requireLearner();
  const state = await attempt(() => getCore().retryExplainer(topicId));
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/topics/${topicId}`);
}

/** Show the Explainer as an infographic or step by step; the core saves a new version. */
export async function switchExplainerForm(topicId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const form = formData.get("form") === "animation" ? "animation" : "infographic";
  const state = await attempt(() => getCore().switchExplainerForm({ topicId, form }));
  revalidatePath(`/topics/${topicId}`);
  return state;
}

/**
 * Thin adapter from the Explainer text form to `editExplainerText`. Key points arrive as aligned
 * `keyPointId` / `keyPointText` lists (an empty id is a new point); labels as `node:<id>`,
 * `edge:<id>` and `group:<id>` fields.
 */
export async function editExplainerText(
  topicId: string,
  baseVersionId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireLearner();
  const ids = formData.getAll("keyPointId").map(String);
  const texts = formData.getAll("keyPointText").map(String);
  const labels = (prefix: string) => {
    const out: Record<string, string> = {};
    for (const [name, value] of formData.entries()) {
      if (name.startsWith(prefix)) out[name.slice(prefix.length)] = String(value);
    }
    return out;
  };
  const state = await attempt(() =>
    getCore().editExplainerText({
      topicId,
      baseVersionId,
      title: String(formData.get("title") ?? ""),
      keyPoints: texts.map((text, i) => ({ id: ids[i] || null, text })),
      analogy: String(formData.get("analogy") ?? ""),
      nodeLabels: labels("node:"),
      edgeLabels: labels("edge:"),
      groupLabels: labels("group:"),
    }),
  );
  if (state.ok) {
    runJobsAfterResponse();
    revalidatePath(`/topics/${topicId}`);
    redirect(`/topics/${topicId}`);
  }
  return state;
}

/** Make an earlier Explainer version current again (the core saves it as a new version). */
export async function restoreExplainerVersion(topicId: string, versionId: string): Promise<void> {
  await requireLearner();
  await attempt(() => getCore().restoreExplainerVersion({ topicId, versionId }));
  runJobsAfterResponse();
  revalidatePath(`/topics/${topicId}`);
  redirect(`/topics/${topicId}`);
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

// Recall Prompts. Wording forms send `kind`, `question` and `expectedPoints` (one per line).

function recallPromptWording(formData: FormData) {
  return {
    kind: String(formData.get("kind") ?? "") as RecallPromptKind,
    question: String(formData.get("question") ?? ""),
    expectedPoints: String(formData.get("expectedPoints") ?? "").split(/\r?\n/),
  };
}

export async function addRecallPrompt(topicId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireLearner();
  const state = await attempt(() => getCore().addRecallPrompt({ topicId, ...recallPromptWording(formData) }));
  revalidatePath(`/topics/${topicId}`);
  return state;
}

export async function editRecallPrompt(
  topicId: string,
  promptId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireLearner();
  const state = await attempt(() => getCore().editRecallPrompt({ promptId, ...recallPromptWording(formData) }));
  revalidatePath(`/topics/${topicId}`);
  return state;
}

export async function suspendRecallPrompt(topicId: string, promptId: string): Promise<void> {
  await requireLearner();
  await attempt(() => getCore().suspendRecallPrompt(promptId));
  revalidatePath(`/topics/${topicId}`);
}

export async function resumeRecallPrompt(topicId: string, promptId: string): Promise<void> {
  await requireLearner();
  await attempt(() => getCore().resumeRecallPrompt(promptId));
  revalidatePath(`/topics/${topicId}`);
}

export async function deleteRecallPrompt(topicId: string, promptId: string): Promise<void> {
  await requireLearner();
  await attempt(() => getCore().deleteRecallPrompt(promptId));
  revalidatePath(`/topics/${topicId}`);
}

export async function generateRecallPrompts(topicId: string): Promise<void> {
  await requireLearner();
  const state = await attempt(() => getCore().generateRecallPrompts(topicId));
  if (state.ok) runJobsAfterResponse();
  revalidatePath(`/topics/${topicId}`);
}
