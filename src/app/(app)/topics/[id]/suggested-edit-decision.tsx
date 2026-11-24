"use client";

import { useActionState } from "react";
import { acceptSuggestedEdit, type FormState, rejectSuggestedEdit } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** Accept or reject one Suggested Edit. Accepting saves a new Explainer version. */
export function SuggestedEditDecision({ topicId, suggestedEditId }: { topicId: string; suggestedEditId: string }) {
  const [accepted, accept, accepting] = useActionState(
    acceptSuggestedEdit.bind(null, topicId, suggestedEditId),
    initialState,
  );
  const [rejected, reject, rejecting] = useActionState(
    rejectSuggestedEdit.bind(null, topicId, suggestedEditId),
    initialState,
  );
  const busy = accepting || rejecting;
  const error = accepted.error ?? rejected.error;
  return (
    <div>
      <div className="button-row">
        <form action={accept}>
          <button type="submit" className="accept" disabled={busy}>
            {accepting ? "Accepting…" : "Accept"}
          </button>
        </form>
        <form action={reject}>
          <button type="submit" disabled={busy}>
            {rejecting ? "Rejecting…" : "Reject"}
          </button>
        </form>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
