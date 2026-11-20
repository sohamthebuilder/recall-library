"use client";

import { useFormStatus } from "react-dom";

/** Submits the surrounding delete form after the learner confirms. */
export function DeleteTopicButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="danger"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(`Delete the Topic “${name}”? Its Sources stay in your Library.`)) e.preventDefault();
      }}
    >
      {pending ? "Deleting…" : "Delete Topic"}
    </button>
  );
}
