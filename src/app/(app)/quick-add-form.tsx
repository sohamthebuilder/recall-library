"use client";

import { useActionState } from "react";
import { addLink, type FormState } from "./actions";

const initialState: FormState = { error: null, ok: false };

/**
 * The add-a-link box: paste a blog post or YouTube link and the core works out which it is.
 * With `sharedLink` (a link shared from another app) it is prefilled. Once added, the
 * learner lands on the new Source.
 */
export function QuickAddForm({ sharedLink }: { sharedLink?: string }) {
  const [state, action, pending] = useActionState(addLink, initialState);
  const shared = sharedLink !== undefined;

  return (
    <form action={action}>
      <label htmlFor="quick-add-link">Link to a blog post or YouTube video</label>
      <div className="quick-add-row">
        <input
          id="quick-add-link"
          name="link"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="Paste a link"
          defaultValue={sharedLink}
          required
        />
        <button className="primary" type="submit" disabled={pending} autoFocus={shared}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
