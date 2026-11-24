"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import type { RecallPrompt } from "@/core";
import { RECALL_PROMPT_KINDS, recallPromptKindLabel } from "@/core/recall-prompt-kinds";
import { type FormState } from "../../actions";

const initialState: FormState = { error: null, ok: false };

type WordingAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Write or edit a Recall Prompt's wording: kind, question and expected key points (one per line).
 * `prompt` pre-fills the form for an edit; without it the form resets after a successful add.
 */
export function RecallPromptForm({
  action: submit,
  prompt,
  submitLabel,
  onDone,
}: {
  action: WordingAction;
  prompt?: RecallPrompt;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(submit, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  useEffect(() => {
    if (!state.ok) return;
    if (!prompt) formRef.current?.reset();
    onDone?.();
  }, [state, prompt, onDone]);

  return (
    <form ref={formRef} action={action} className="recall-prompt-form">
      <label htmlFor={`${id}-kind`}>Kind</label>
      <select id={`${id}-kind`} name="kind" defaultValue={prompt?.kind ?? "explain"}>
        {RECALL_PROMPT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {recallPromptKindLabel(kind)}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-question`}>Question</label>
      <textarea id={`${id}-question`} name="question" rows={2} required defaultValue={prompt?.question} />
      <label htmlFor={`${id}-points`}>Expected key points</label>
      <textarea
        id={`${id}-points`}
        name="expectedPoints"
        rows={3}
        required
        aria-describedby={`${id}-points-hint`}
        defaultValue={prompt?.expectedPoints.join("\n")}
      />
      <p id={`${id}-points-hint`} className="hint">
        One per line.
      </p>
      <div className="button-row">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
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
