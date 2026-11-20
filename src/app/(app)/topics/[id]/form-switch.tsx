"use client";

import { useActionState } from "react";
import type { ExplainerForm } from "@/core";
import { type FormState, switchExplainerForm } from "../../actions";

const initialState: FormState = { error: null, ok: false };
const LABELS: Record<ExplainerForm, string> = { infographic: "Infographic", animation: "Step by step" };

/** Choose how the Explainer is shown. Switching saves a new version. */
export function FormSwitch({ topicId, form }: { topicId: string; form: ExplainerForm }) {
  const [state, action, pending] = useActionState(switchExplainerForm.bind(null, topicId), initialState);
  return (
    <form action={action} className="form-switch">
      <div role="group" aria-label="Show as" className="segmented">
        {(Object.keys(LABELS) as ExplainerForm[]).map((f) => (
          <button
            key={f}
            type="submit"
            name="form"
            value={f}
            aria-pressed={f === form}
            className={f === form ? "active" : undefined}
            disabled={pending || f === form}
          >
            {LABELS[f]}
          </button>
        ))}
      </div>
      {pending ? (
        <span className="muted" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Switching…
        </span>
      ) : null}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
