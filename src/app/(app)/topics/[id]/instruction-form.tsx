"use client";

import { useActionState } from "react";
import { editExplainerByInstruction, type InstructionState } from "../../actions";
import { RestoreVersionButton } from "./restore-version-button";

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
        <RestoreVersionButton
          topicId={topicId}
          versionId={state.previousVersionId}
          label="Restore the previous version"
          className="instruction-undo"
          buttonClassName="button-link"
        >
          <span className="muted" aria-live="polite">
            Explainer changed.
          </span>{" "}
        </RestoreVersionButton>
      ) : null}
    </div>
  );
}
