"use client";

import { useActionState } from "react";
import { linkSourceToTopic, type FormState } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** Link an existing Source in the Library to this Topic by hand. */
export function LinkSourceForm({
  topicId,
  sources,
}: {
  topicId: string;
  sources: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(linkSourceToTopic.bind(null, topicId), initialState);

  if (sources.length === 0) return null;

  return (
    <form action={action}>
      <label htmlFor="link-source">Link a Source from your Library</label>
      <select id="link-source" name="sourceId" required defaultValue="">
        <option value="" disabled>
          Choose a Source…
        </option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Linking…" : "Link Source"}
      </button>
    </form>
  );
}
