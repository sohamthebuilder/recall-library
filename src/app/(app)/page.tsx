import { getCore } from "@/server/core";
import { AddNoteForm } from "./add-note-form";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function LibraryPage() {
  const { sources } = await getCore().library();

  return (
    <div className="two-column">
      <section className="panel" aria-labelledby="add-note">
        <h2 id="add-note">Add a Note</h2>
        <AddNoteForm />
      </section>

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
                {source.title ? <h3>{source.title}</h3> : null}
                <p>{source.text}</p>
                <div className="source-meta">
                  Note · added{" "}
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
