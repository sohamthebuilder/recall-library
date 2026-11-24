"use client";

import { useFormStatus } from "react-dom";

/** Submits the surrounding form only after the learner confirms (for anything destructive). */
export function ConfirmButton({
  label,
  pendingLabel,
  confirmMessage,
  className = "danger",
  ariaLabel,
}: {
  label: string;
  pendingLabel?: string;
  confirmMessage: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? label) : label}
    </button>
  );
}
