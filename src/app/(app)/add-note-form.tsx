"use client";

import { useActionState } from "react";
import { addNote, type AddNoteState } from "./actions";

const initialState: AddNoteState = { error: null, ok: false };

export function AddNoteForm() {
  const [state, action, pending] = useActionState(addNote, initialState);

  return (
    <form action={action}>
      <label htmlFor="note-title">Title (optional)</label>
      <input id="note-title" name="title" type="text" autoComplete="off" />

      <label htmlFor="note-text">Note</label>
      <textarea id="note-text" name="text" required />

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add Note"}
      </button>
    </form>
  );
}
