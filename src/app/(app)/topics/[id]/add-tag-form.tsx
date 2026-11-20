"use client";

import { useActionState, useEffect, useRef } from "react";
import { type FormState, tagTopic } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** Add a Tag to a Topic. Suggests the Tags already in use. */
export function AddTagForm({ topicId, existingTags }: { topicId: string; existingTags: string[] }) {
  const [state, action, pending] = useActionState(tagTopic.bind(null, topicId), initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="tag-form">
      <label htmlFor="tag-name">Add a Tag</label>
      <div className="button-row">
        <input id="tag-name" name="name" type="text" autoComplete="off" list="existing-tags" required />
        <button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <datalist id="existing-tags">
        {existingTags.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
