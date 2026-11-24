"use client";

import { useActionState } from "react";
import { uploadMarkdown, type FormState } from "./actions";

const initialState: FormState = { error: null, ok: false };

/**
 * Pick a .md file and upload it as a Source. `accept` also lists text/plain because some
 * phone file pickers don't recognise .md and would grey the file out; the core refuses
 * anything that isn't a .md file.
 */
export function UploadMarkdownForm() {
  const [state, action, pending] = useActionState(uploadMarkdown, initialState);

  return (
    <form action={action}>
      <label htmlFor="markdown-file">File</label>
      <input
        id="markdown-file"
        name="file"
        type="file"
        accept=".md,.markdown,text/markdown,text/x-markdown,text/plain"
        required
      />

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
