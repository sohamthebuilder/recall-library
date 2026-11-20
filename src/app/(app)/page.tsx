import Link from "next/link";
import { isSourceProcessing } from "@/core";
import { getCore } from "@/server/core";
import { AddNoteForm } from "./add-note-form";
import { AddUrlForm } from "./add-url-form";
import { SourceMeta, sourceDisplayTitle } from "./source-meta";
import { RefreshWhileProcessing, StatusBadge } from "./source-status";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { sources } = await getCore().library();

  return (
    <div className="two-column">
      <RefreshWhileProcessing active={sources.some((s) => isSourceProcessing(s.status))} />
      <div className="stack">
        <section className="panel" aria-labelledby="add-url">
          <h2 id="add-url">Add a blog post</h2>
          <AddUrlForm />
        </section>
        <section className="panel" aria-labelledby="add-note">
          <h2 id="add-note">Add a Note</h2>
          <AddNoteForm />
        </section>
      </div>

      <section aria-labelledby="library">
        <h2 id="library" style={{ marginTop: 0 }}>
          Library
        </h2>
        {sources.length === 0 ? (
          <p className="muted">Nothing here yet. Add a blog post or a Note to start your Library.</p>
        ) : (
          <ul className="source-list">
            {sources.map((source) => (
              <li key={source.id} className="panel source-item">
                <div className="row-between">
                  <h3>
                    <Link href={`/sources/${source.id}`}>{sourceDisplayTitle(source)}</Link>
                  </h3>
                  <StatusBadge status={source.status} />
                </div>
                {source.text ? <p className="clamp">{source.text}</p> : null}
                {source.status === "failed" && source.failureReason ? (
                  <p className="error">{source.failureReason}</p>
                ) : null}
                <SourceMeta source={source} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
