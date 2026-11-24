"use client";

import { useActionState } from "react";
import { type FormState, restoreExplainerVersion } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** Make an earlier Explainer version current again; goes to the Topic on success, shows why if refused. */
export function RestoreVersionButton({
  topicId,
  versionId,
  label,
  className,
  buttonClassName,
  children,
}: {
  topicId: string;
  versionId: string;
  label: string;
  className?: string;
  buttonClassName?: string;
  children?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(restoreExplainerVersion.bind(null, topicId, versionId), initialState);
  return (
    <form action={action} className={className}>
      {children}
      <button type="submit" className={buttonClassName} disabled={pending}>
        {pending ? "Restoring…" : label}
      </button>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
