"use client";

import { useState } from "react";
import { AddNoteForm } from "../add-note-form";
import { QuickAddForm } from "../quick-add-form";
import { UploadMarkdownForm } from "../upload-markdown-form";
import { UploadPdfForm } from "../upload-pdf-form";

const tabs = [
  { kind: "link", label: "Link" },
  { kind: "note", label: "Note" },
  { kind: "markdown", label: ".md file" },
  { kind: "pdf", label: "PDF" },
] as const;

type Kind = (typeof tabs)[number]["kind"];

/** One Add box: a link field (blog post or YouTube) with Note, .md and PDF as tabs. */
export function AddBox({ initial }: { initial: Kind }) {
  const [kind, setKind] = useState<Kind>(initial);
  return (
    <div className="panel add-box">
      <div className="segmented add-tabs" role="tablist" aria-label="What to add">
        {tabs.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            id={`tab-${tab.kind}`}
            aria-selected={kind === tab.kind}
            aria-controls={`panel-${tab.kind}`}
            className={kind === tab.kind ? "active" : undefined}
            onClick={() => setKind(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${kind}`} aria-labelledby={`tab-${kind}`}>
        {kind === "link" ? <QuickAddForm /> : null}
        {kind === "note" ? <AddNoteForm /> : null}
        {kind === "markdown" ? <UploadMarkdownForm /> : null}
        {kind === "pdf" ? <UploadPdfForm /> : null}
      </div>
    </div>
  );
}
