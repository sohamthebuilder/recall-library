"use client";

import { useActionState } from "react";
import { editExplainerByInstruction, type InstructionState, restoreExplainerVersion } from "../../actions";

const initialState: InstructionState = { error: null, ok: false, previousVersionId: null, newVersionId: null };

/**
 * Tell the AI how to reshape the Explainer ("use a restaurant analogy", "show the partitions").
 * A usable result becomes a new version; while it is current, the learner can put the previous one back.
 */
export function InstructionForm({ topicId, versionId }: { topicId: string; versionId: string }) {
  const [state, action, pending] = useActionState(editExplainerByInstruction.bind(null, topicId, versionId), initialState);
  return (
    <div className="instruction">
      <form action={action} className="instruction-form">
        <label htmlFor="explainer-instruction" className="visually-hidden">
          Change the Explainer
        </label>
        <input
          id="explainer-instruction"
          name="instruction"
          type="text"
          maxLength={1000}
          required
          placeholder="Change it: “use a restaurant analogy”, “show the partitions”…"
          disabled={pending}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Changing…" : "Change"}
        </button>
      </form>
      {pending ? (
        <p className="muted" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Asking the AI to change the Explainer…
        </p>
      ) : null}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.previousVersionId && state.newVersionId === versionId ? (
        <form action={restoreExplainerVersion.bind(null, topicId, state.previousVersionId)} className="instruction-undo">
          <span className="muted" aria-live="polite">
            Explainer changed.
          </span>{" "}
          <button type="submit" className="button-link">
            Restore the previous version
          </button>
        </form>
      ) : null}
    </div>
  );
}
