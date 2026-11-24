"use client";

import { useActionState } from "react";
import type { Chapter } from "@/core";
import { type FormState, selectChapters } from "../../actions";

const initialState: FormState = { error: null, ok: false };

const statusText: Record<Chapter["status"], string | null> = {
  not_selected: null,
  proposing: "Proposing Topics…",
  proposed: "Topics proposed",
  failed: "Failed",
};

/** A PDF's chapters (outline or page ranges): tick the ones to propose Topics from. */
export function ChapterSelection({ sourceId, chapters }: { sourceId: string; chapters: Chapter[] }) {
  const [state, action, pending] = useActionState(selectChapters.bind(null, sourceId), initialState);
  const selectable = chapters.filter((c) => c.status === "not_selected" || c.status === "failed");

  return (
    <form action={action} className="chapter-selection" aria-labelledby="chapters-heading">
      <h3 id="chapters-heading" className="subheading">
        Chapters
      </h3>
      <ul className="plain-list">
        {chapters.map((chapter) => {
          const canSelect = chapter.status === "not_selected" || chapter.status === "failed";
          const pages =
            chapter.startPage === chapter.endPage ? `p. ${chapter.startPage}` : `pp. ${chapter.startPage}–${chapter.endPage}`;
          return (
            <li key={chapter.id} className="chapter-option">
              <label>
                <input type="checkbox" name="chapterId" value={chapter.id} disabled={!canSelect} defaultChecked={false} />{" "}
                {chapter.title} <span className="muted">({pages})</span>
                {statusText[chapter.status] ? <span className="muted"> · {statusText[chapter.status]}</span> : null}
              </label>
              {chapter.status === "failed" && chapter.failureReason ? (
                <p className="error" style={{ margin: "2px 0 0" }}>
                  {chapter.failureReason}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      {selectable.length > 0 ? (
        <button type="submit" disabled={pending}>
          {pending ? "Selecting…" : "Propose Topics from selected chapters"}
        </button>
      ) : (
        <p className="muted">Topics have been proposed from every chapter.</p>
      )}
    </form>
  );
}
