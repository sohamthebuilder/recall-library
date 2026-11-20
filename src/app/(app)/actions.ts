"use server";

import { revalidatePath } from "next/cache";
import { requireLearner } from "@/auth";
import { ValidationError } from "@/core";
import { getCore } from "@/server/core";

export type AddNoteState = { error: string | null; ok: boolean };

/** Thin adapter from the form to `addSource`; all rules live in the core. */
export async function addNote(_prev: AddNoteState, formData: FormData): Promise<AddNoteState> {
  await requireLearner();
  try {
    await getCore().addSource({
      kind: "note",
      title: String(formData.get("title") ?? ""),
      text: String(formData.get("text") ?? ""),
    });
  } catch (e) {
    if (e instanceof ValidationError) return { error: e.message, ok: false };
    throw e;
  }
  revalidatePath("/");
  return { error: null, ok: true };
}
