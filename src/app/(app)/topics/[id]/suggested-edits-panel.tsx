import Link from "next/link";
import type { SuggestedEdit } from "@/core";
import { SuggestedEditDecision } from "./suggested-edit-decision";

/**
 * Pending Suggested Edits from newly added Sources (ADR 0001): the Explainer only changes when
 * the learner accepts one. Renders nothing when there are none.
 */
export function SuggestedEditsPanel({ topicId, edits }: { topicId: string; edits: SuggestedEdit[] }) {
  if (edits.length === 0) return null;
  return (
    <section className="panel suggested-edits" aria-labelledby="suggested-edits">
      <h2 id="suggested-edits">Suggested Edits</h2>
      <p className="muted">
        A new Source adds to or contradicts your Explainer. Accept the edits you agree with; your Explainer changes only
        when you do.
      </p>
      <ul className="suggested-edit-list">
        {edits.map((edit) => (
          <li key={edit.id} className="suggested-edit">
            <div className="suggested-edit-head">
              <span className={edit.kind === "contradicts" ? "badge badge-contradicts" : "badge badge-pending"}>
                {edit.kind === "contradicts" ? "Contradicts" : "Adds"}
              </span>
              <span>
                From <Link href={`/sources/${edit.source.id}`}>{edit.source.name}</Link>
              </span>
            </div>
            <p>{edit.summary}</p>
            <div className="suggested-edit-change">
              <div>
                <h3 className="compare-heading">{edit.keyPointId === null ? "Now" : "Your key point"}</h3>
                <p className={edit.currentText === null ? "muted" : undefined}>
                  {edit.keyPointId === null
                    ? "Not in your Explainer."
                    : (edit.currentText ?? "You have removed this key point.")}
                </p>
              </div>
              <div>
                <h3 className="compare-heading">{edit.keyPointId === null ? "New key point" : "Suggested"}</h3>
                <p>{edit.proposedText}</p>
              </div>
            </div>
            {edit.passages.map((p) =>
              p.status === "available" ? (
                <blockquote key={p.chunkId} className="passage">
                  <p>{p.text}</p>
                </blockquote>
              ) : null,
            )}
            <SuggestedEditDecision topicId={topicId} suggestedEditId={edit.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
