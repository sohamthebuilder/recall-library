"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import type { ExplainerContent } from "@/core";
import { editExplainerText, type FormState } from "../../../../actions";

const initialState: FormState = { error: null, ok: false };

type Point = { key: string; id: string; text: string };

/**
 * Edit an Explainer's text: title, key points (reorder, remove, add), analogy and the diagram's
 * labels. Saving makes a new version; the diagram's shape changes only by instruction.
 */
export function ExplainerTextForm({
  topicId,
  versionId,
  content,
}: {
  topicId: string;
  versionId: string;
  content: ExplainerContent;
}) {
  const [state, action, pending] = useActionState(editExplainerText.bind(null, topicId, versionId), initialState);
  const id = useId();
  const [points, setPoints] = useState<Point[]>(() => content.keyPoints.map((k) => ({ key: k.id, id: k.id, text: k.text })));
  const [nextKey, setNextKey] = useState(1);

  const move = (i: number, by: number) =>
    setPoints((ps) => {
      const out = [...ps];
      const [p] = out.splice(i, 1);
      out.splice(i + by, 0, p!);
      return out;
    });

  return (
    <form action={action} className="explainer-edit">
      <label htmlFor={`${id}-title`}>Title</label>
      <input id={`${id}-title`} name="title" required maxLength={200} defaultValue={content.title} />

      <fieldset className="explainer-edit-group">
        <legend>Key points</legend>
        <ol className="explainer-edit-points">
          {points.map((p, i) => (
            <li key={p.key}>
              <input type="hidden" name="keyPointId" value={p.id} />
              <label htmlFor={`${id}-kp-${p.key}`} className="visually-hidden">
                Key point {i + 1}
              </label>
              <textarea
                id={`${id}-kp-${p.key}`}
                name="keyPointText"
                rows={2}
                required
                maxLength={2000}
                value={p.text}
                onChange={(e) => setPoints((ps) => ps.map((q) => (q.key === p.key ? { ...q, text: e.target.value } : q)))}
              />
              <div className="button-row">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move key point ${i + 1} up`}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === points.length - 1}
                  aria-label={`Move key point ${i + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setPoints((ps) => ps.filter((q) => q.key !== p.key))}
                  disabled={points.length === 1}
                >
                  Remove
                </button>
                {p.id === "" ? <span className="hint">New: cites no Source</span> : null}
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => {
            setPoints((ps) => [...ps, { key: `new-${nextKey}`, id: "", text: "" }]);
            setNextKey((n) => n + 1);
          }}
        >
          Add a key point
        </button>
      </fieldset>

      <label htmlFor={`${id}-analogy`}>Analogy</label>
      <textarea
        id={`${id}-analogy`}
        name="analogy"
        rows={3}
        maxLength={2000}
        defaultValue={content.analogy ?? ""}
        aria-describedby={`${id}-analogy-hint`}
      />
      <p id={`${id}-analogy-hint`} className="hint">
        Leave it empty for no analogy.
      </p>

      {content.diagram.nodes.length > 0 ? (
        <fieldset className="explainer-edit-group">
          <legend>Diagram labels</legend>
          <div className="explainer-edit-labels">
            {content.diagram.groups.map((g) => (
              <Label key={`g-${g.id}`} name={`group:${g.id}`} what={`Group “${g.label}”`} value={g.label} required />
            ))}
            {content.diagram.nodes.map((n) => (
              <Label key={`n-${n.id}`} name={`node:${n.id}`} what={`Box “${n.label}”`} value={n.label} required />
            ))}
            {content.diagram.edges.map((e) => {
              const label = (nodeId: string) => content.diagram.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
              return (
                <Label
                  key={`e-${e.id}`}
                  name={`edge:${e.id}`}
                  what={`Arrow ${label(e.from)} → ${label(e.to)}`}
                  value={e.label ?? ""}
                />
              );
            })}
          </div>
          <p className="hint">To change the diagram&apos;s shape, ask the AI instead.</p>
        </fieldset>
      ) : null}

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="button-row">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Saving…" : "Save as a new version"}
        </button>
        <Link href={`/topics/${topicId}`} className="button-link">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Label({ name, what, value, required }: { name: string; what: string; value: string; required?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{what}</label>
      <input id={id} name={name} defaultValue={value} required={required} maxLength={200} />
    </div>
  );
}
