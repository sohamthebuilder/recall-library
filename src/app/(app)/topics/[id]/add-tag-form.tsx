"use client";

import { useActionState, useEffect, useState } from "react";
import { type FormState, tagTopic } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** Add a Tag to a Topic, from a small "+" beside its Tags. Suggests the Tags already in use. */
export function AddTagForm({ topicId, existingTags }: { topicId: string; existingTags: string[] }) {
  const [state, action, pending] = useActionState(tagTopic.bind(null, topicId), initialState);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <div className="tag-add">
      <button
        type="button"
        className="tag-add-toggle"
        aria-label="Add a Tag"
        title="Add a Tag"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        +
      </button>
      {open ? (
        <form
          action={action}
          className="tag-form tag-popover"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <label htmlFor="tag-name">Add a Tag</label>
          <div className="button-row">
            <input id="tag-name" name="name" type="text" autoComplete="off" list="existing-tags" required autoFocus />
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
      ) : null}
    </div>
  );
}
