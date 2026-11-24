"use client";

import { useActionState, useEffect, useRef } from "react";
import { addYouTubeVideo, type FormState } from "./actions";

const initialState: FormState = { error: null, ok: false };

export function AddYouTubeForm() {
  const [state, action, pending] = useActionState(addYouTubeVideo, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action}>
      <label htmlFor="youtube-url">YouTube link</label>
      <input
        id="youtube-url"
        name="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://www.youtube.com/watch?v=…"
        required
      />

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add video"}
      </button>
    </form>
  );
}
