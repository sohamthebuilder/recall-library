"use client";

import { useFormStatus } from "react-dom";

/** The confirmation shown before deleting a Source, naming how many Explainers cite it. */
function deleteSourceWarning(name: string, citingExplainers: number): string {
  const cited =
    citingExplainers === 0
      ? "No Explainer cites it."
      : `${citingExplainers} Explainer${citingExplainers === 1 ? " cites" : "s cite"} it. ` +
        `${citingExplainers === 1 ? "It stays" : "They stay"} unchanged, with those citations marked “Source removed”.`;
  return `Delete the Source “${name}”? ${cited}`;
}

/** Submits the surrounding delete form after the learner confirms. */
export function DeleteSourceButton({ name, citingExplainers }: { name: string; citingExplainers: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="danger"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(deleteSourceWarning(name, citingExplainers))) e.preventDefault();
      }}
    >
      {pending ? "Deleting…" : "Delete Source"}
    </button>
  );
}
