"use client";

import { useActionState, useEffect, useRef } from "react";
import { addUrl, type FormState } from "./actions";

const initialState: FormState = { error: null, ok: false };

export function AddUrlForm() {
  const [state, action, pending] = useActionState(addUrl, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action}>
      <label htmlFor="url-url">Link to a blog post or article</label>
      <input id="url-url" name="url" type="url" inputMode="url" placeholder="https://" autoComplete="off" required />

      <label htmlFor="url-title">Title (optional)</label>
      <input id="url-title" name="title" type="text" autoComplete="off" />

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add link"}
      </button>
    </form>
  );
}
