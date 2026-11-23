import Link from "next/link";
import { notFound } from "next/navigation";
import { type CitedPassage, NotFoundError } from "@/core";
import { getCore } from "@/server/core";

export const dynamic = "force-dynamic";

/** The current key points next to the Source passages they cite: what the learner changed, and what the Source says. */
export default async function CompareExplainerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const core = getCore();
  let topic, rows;
  try {
    topic = await core.topic(id);
    rows = await core.explainerComparison(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <>
      <header className="topic-header">
        <p className="muted" style={{ margin: "0 0 4px" }}>
          <Link href={`/topics/${topic.id}`}>← {topic.name}</Link>
        </p>
        <h2>Your Explainer and its Sources</h2>
        <p className="muted">Each key point as you study it, next to the passage it cites.</p>
      </header>

      <ol className="compare-list">
        {rows.map((row, i) => (
          <li key={row.keyPointId} className="panel compare-row">
            <div>
              <h3 className="compare-heading">
                Key point {i + 1}{" "}
                {row.origin === "learner" ? (
                  <span className="badge">Added by you</span>
                ) : (
                  <>
                    {row.origin === "suggested_edit" ? <span className="badge">From a Suggested Edit</span> : null}
                    {row.edited ? <span className="badge">Edited</span> : null}
                  </>
                )}
              </h3>
              <p className="compare-text">{row.text}</p>
              {row.edited && row.generatedText !== null ? (
                <p className="hint">
                  <span className="muted">{row.origin === "suggested_edit" ? "Suggested as:" : "First written as:"}</span> {row.generatedText}
                </p>
              ) : null}
            </div>
            <div>
              <h3 className="compare-heading">Source</h3>
              {row.passages.length === 0 ? (
                <p className="muted">This point cites no Source.</p>
              ) : (
                row.passages.map((p) => <Passage key={p.chunkId} passage={p} />)
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function Passage({ passage }: { passage: CitedPassage }) {
  if (passage.status === "source_removed") return <blockquote className="passage muted">Source removed.</blockquote>;
  return (
    <blockquote className="passage">
      <p>{passage.text}</p>
      <footer>
        <Link href={`/sources/${passage.sourceId}`}>{passage.sourceTitle ?? "Untitled Source"}</Link>
      </footer>
    </blockquote>
  );
}
