import Link from "next/link";
import { isSourceProcessing, sourceDisplayName, sourceKindLabel } from "@/core";
import { getCore } from "@/server/core";
import { AddNoteForm } from "./add-note-form";
import { UploadMarkdownForm } from "./upload-markdown-form";
import { RefreshWhileProcessing, StatusBadge } from "./source-status";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function LibraryPage() {
  const { sources } = await getCore().library();

  return (
    <div className="two-column">
      <RefreshWhileProcessing active={sources.some((s) => isSourceProcessing(s.status))} />
      <div className="stack">
        <section className="panel" aria-labelledby="add-note">
          <h2 id="add-note">Add a Note</h2>
          <AddNoteForm />
        </section>
        <section className="panel" aria-labelledby="upload-markdown">
          <h2 id="upload-markdown">Upload a .md file</h2>
          <UploadMarkdownForm />
        </section>
      </div>

      <section aria-labelledby="library">
        <h2 id="library" style={{ marginTop: 0 }}>
          Library
        </h2>
        {sources.length === 0 ? (
          <p className="muted">Nothing here yet. Add a Note to start your Library.</p>
        ) : (
          <ul className="source-list">
            {sources.map((source) => (
              <li key={source.id} className="panel source-item">
                <div className="row-between">
                  <h3>
                    <Link href={`/sources/${source.id}`}>{sourceDisplayName(source)}</Link>
                  </h3>
                  <StatusBadge status={source.status} />
                </div>
                {source.text ? <p className="clamp">{source.text}</p> : null}
                {source.status === "failed" && source.failureReason ? (
                  <p className="error">{source.failureReason}</p>
                ) : null}
                <div className="source-meta">
                  {sourceKindLabel(source.kind)}
                  {source.title && source.reference ? ` · ${source.reference}` : null} · added{" "}
                  <time dateTime={source.addedAt.toISOString()}>{dateFormat.format(source.addedAt)}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
