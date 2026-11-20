"use client";

import { useCallback, useRef } from "react";
import type { RecallPrompt } from "@/core";
import { editRecallPrompt } from "../../actions";
import { RecallPromptForm } from "./recall-prompt-form";

/** "Edit" disclosure on a Recall Prompt; closes once the edit is saved. */
export function EditRecallPrompt({ topicId, prompt }: { topicId: string; prompt: RecallPrompt }) {
  const details = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => details.current?.removeAttribute("open"), []);
  return (
    <details ref={details} className="recall-prompt-edit">
      <summary>Edit</summary>
      <RecallPromptForm
        action={editRecallPrompt.bind(null, topicId, prompt.id)}
        prompt={prompt}
        submitLabel="Save"
        onDone={close}
      />
    </details>
  );
}
