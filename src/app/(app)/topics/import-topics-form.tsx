"use client";

import { useActionState, useEffect, useRef } from "react";
import { importTopics, type ImportTopicsState } from "../actions";

const initialState: ImportTopicsState = { error: null, ok: false, message: null };

/** Paste a list of Topics, one per line, to set up the outline of what to learn. */
export function ImportTopicsForm() {
  const [state, action, pending] = useActionState(importTopics, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action}>
      <label htmlFor="topic-list">Topics, one per line</label>
      <textarea id="topic-list" name="list" required placeholder={"Kafka consumer groups\nRaft leader election"} />

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p className="muted" role="status">
          {state.message}
        </p>
      ) : null}

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add Topics"}
      </button>
    </form>
  );
}
