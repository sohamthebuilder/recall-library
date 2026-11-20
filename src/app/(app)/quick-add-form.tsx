"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { addLink, type FormState } from "./actions";

const initialState: FormState = { error: null, ok: false };

/**
 * The add-a-link box: paste a blog post or YouTube link and the core works out which it is.
 * With `sharedLink` (a link shared from another app) it is prefilled and goes to the
 * Library once added.
 */
export function QuickAddForm({ sharedLink }: { sharedLink?: string }) {
  const [state, action, pending] = useActionState(addLink, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const shared = sharedLink !== undefined;

  useEffect(() => {
    if (!state.ok) return;
    if (shared) router.replace("/");
    else formRef.current?.reset();
  }, [state, shared, router]);

  return (
    <form ref={formRef} action={action}>
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
