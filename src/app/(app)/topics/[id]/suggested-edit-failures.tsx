"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { SuggestedEditFailure } from "@/core";
import { type FormState, retrySuggestedEdits } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** Linked Sources the AI failed to check for Suggested Edits, each with a Retry. Renders nothing when there are none. */
export function SuggestedEditFailures({ topicId, failures }: { topicId: string; failures: SuggestedEditFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <section className="panel suggested-edit-failures" aria-label="Suggested Edits that couldn't be checked">
      <ul className="suggested-edit-failure-list">
        {failures.map((f) => (
          <FailureRow key={f.source.id} topicId={topicId} failure={f} />
        ))}
      </ul>
    </section>
  );
}

function FailureRow({ topicId, failure }: { topicId: string; failure: SuggestedEditFailure }) {
  const [state, action, pending] = useActionState(
    retrySuggestedEdits.bind(null, topicId, failure.source.id),
    initialState,
  );
  return (
    <li>
      <p>
        Couldn&apos;t check{" "}
        <Link href={`/sources/${failure.source.id}`}>{failure.source.name}</Link> for Suggested
        Edits. <span className="muted">{failure.reason}</span>
      </p>
      {state.ok ? (
        <p className="muted" aria-live="polite">
          Checking again…
        </p>
      ) : (
        <form action={action}>
          <button type="submit" disabled={pending}>
            {pending ? "Retrying…" : "Retry"}
          </button>
        </form>
      )}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}
