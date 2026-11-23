import Link from "next/link";
import { notFound } from "next/navigation";
import { type ExplainerVersionSummary, NotFoundError } from "@/core";
import { getCore } from "@/server/core";
import { ExplainerDiagramView } from "../../explainer-diagram";
import { KeyPoints } from "../../key-points";
import { RestoreVersionButton } from "../../restore-version-button";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** What caused a version, in the learner's words. */
function causeLabel(v: ExplainerVersionSummary): string {
  switch (v.cause) {
    case "generated":
      return "Made from the Sources";
    case "instruction":
      return v.instruction ? `Changed by instruction: “${v.instruction}”` : "Changed by instruction";
    case "text_edit":
      return "You edited the text";
    case "suggested_edit":
      return "Suggested Edit accepted";
    case "restore":
      return v.restoredFrom ? `Restored version ${v.restoredFrom}` : "Restored an earlier version";
    case "form_switch":
      return "Switched form";
  }
}

/** Every version of the Explainer, newest first, with one opened to look at (and restore). */
export default async function ExplainerVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const core = getCore();
  let topic, versions;
  try {
    [topic, versions] = await Promise.all([core.topic(id), core.explainerVersions(id)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (versions.length === 0) notFound();

  const selectedId = versions.some((x) => x.id === v) ? v! : versions[0]!.id;
  const opened = await core.explainerVersion({ topicId: topic.id, versionId: selectedId });
  const { content } = opened.version;

  return (
    <>
      <header className="topic-header">
        <p className="muted" style={{ margin: "0 0 4px" }}>
          <Link href={`/topics/${topic.id}`}>← {topic.name}</Link>
        </p>
        <h2>Explainer versions</h2>
        <p className="muted">Every change is kept. Restoring an older version makes a new version from it.</p>
      </header>

      <div className="versions-layout">
        <nav aria-label="Versions" className="panel">
          <ol className="version-list">
            {versions.map((x, i) => (
              <li key={x.id}>
                <Link
                  href={`/topics/${topic.id}/explainer/versions?v=${x.id}`}
                  aria-current={x.id === selectedId ? "page" : undefined}
                  className={x.id === selectedId ? "version-link active" : "version-link"}
                >
                  <strong>Version {x.number}</strong>
                  {i === 0 ? <span className="badge badge-ready">Current</span> : null}
                  <span className="version-meta">
                    {causeLabel(x)} · <time dateTime={x.createdAt.toISOString()}>{dateFormat.format(x.createdAt)}</time>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <article className="panel explainer" aria-labelledby="version-title">
          <div className="explainer-head">
            <h2 id="version-title" className="explainer-title">
              {content.title}
            </h2>
            {opened.isCurrent ? (
              <span className="muted">This is the current version.</span>
            ) : (
              <RestoreVersionButton
                topicId={topic.id}
                versionId={opened.version.id}
                label={`Restore version ${opened.version.number}`}
                buttonClassName="primary"
              />
            )}
          </div>
          {content.analogy ? (
            <aside className="analogy">
              <strong>Think of it like this:</strong> {content.analogy}
            </aside>
          ) : null}
          <div className="explainer-body">
            <ExplainerDiagramView diagram={content.diagram} title={content.title} />
            <KeyPoints keyPoints={content.keyPoints} passages={opened.passages} />
          </div>
        </article>
      </div>
    </>
  );
}
