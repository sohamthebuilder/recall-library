import Link from "next/link";
import { notFound } from "next/navigation";
import { citationUrl, isSourceProcessing, NotFoundError } from "@/core";
import { getCore } from "@/server/core";
import { retrySource } from "../../actions";
import { SourceMeta, sourceDisplayTitle } from "../../source-meta";
import { RefreshWhileProcessing, StatusBadge } from "../../source-status";
import { ChapterSelection } from "./chapter-selection";
import { ProposalCard } from "./proposal-card";

export const dynamic = "force-dynamic";

/** 75 → "1:15", 3725 → "1:02:05". */
function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(Math.floor(total % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const core = getCore();
  let source;
  try {
    source = await core.source(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [proposals, topics, chunks, chapters] = await Promise.all([
    core.topicProposals(id),
    core.topics(),
    source.kind === "youtube" ? core.sourceChunks(id) : Promise.resolve([]),
    source.kind === "pdf" ? core.sourceChapters(id) : Promise.resolve([]),
  ]);
  const pending = proposals.filter((p) => p.status === "pending");
  const decided = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="two-column wide-right">
      <RefreshWhileProcessing active={isSourceProcessing(source.status)} />
      <section className="panel" aria-labelledby="source-title">
        <p className="muted" style={{ margin: "0 0 8px" }}>
          <Link href="/">← Library</Link>
        </p>
        <div className="row-between">
          <h2 id="source-title">{sourceDisplayTitle(source)}</h2>
          <StatusBadge status={source.status} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <SourceMeta source={source} />
        </div>
        {source.status === "failed" ? (
          <form action={retrySource.bind(null, source.id)}>
            <p className="error" role="alert">
              {source.failureReason}
            </p>
            <button className="primary" type="submit">
              Retry
            </button>
          </form>
        ) : null}
        {source.kind === "youtube" && chunks.length > 0 ? (
          <ol className="plain-list">
            {chunks.map((chunk) => (
              <li key={chunk.id} style={{ marginBottom: 12 }}>
                <a href={citationUrl(source, chunk.anchor) ?? undefined} target="_blank" rel="noreferrer">
                  {formatSeconds(chunk.anchor.seconds ?? 0)}
                </a>{" "}
                <span className="source-text">{chunk.text}</span>
              </li>
            ))}
          </ol>
        ) : source.text ? (
          <p className="source-text">{source.text}</p>
        ) : null}
      </section>

      <section aria-labelledby="proposed-topics">
        <h2 id="proposed-topics" style={{ marginTop: 0 }}>
          Proposed Topics
        </h2>
        {source.kind === "pdf" && chapters.length > 0 ? (
          <ChapterSelection sourceId={source.id} chapters={chapters} />
        ) : null}
        {source.kind === "pdf" && source.status === "proposing_topics" ? (
          <p className="muted">Proposing Topics from the selected chapters…</p>
        ) : isSourceProcessing(source.status) ? (
          <p className="muted">Topics will appear here once this Source has been read.</p>
        ) : source.kind === "pdf" && proposals.length === 0 && chapters.length > 0 ? (
          <p className="muted">Select chapters above to propose Topics from them.</p>
        ) : proposals.length === 0 ? (
          <p className="muted">No Topics were proposed for this Source.</p>
        ) : null}
        {pending.length > 0 ? (
          <ul className="source-list">
            {pending.map((proposal) => (
              <li key={proposal.id}>
                <ProposalCard proposal={proposal} topics={topics.map(({ id, name }) => ({ id, name }))} />
              </li>
            ))}
          </ul>
        ) : null}
        {decided.length > 0 ? (
          <>
            <h3 className="subheading">Decided</h3>
            <ul className="plain-list">
              {decided.map((p) => (
                <li key={p.id}>
                  {p.status === "rejected" ? (
                    <span className="muted">
                      <s>{p.name}</s> rejected
                    </span>
                  ) : p.resolvedTopic ? (
                    <>
                      {p.name} → <Link href={`/topics/${p.resolvedTopic.topicId}`}>{p.resolvedTopic.name}</Link>
                    </>
                  ) : (
                    <span className="muted">{p.name} (Topic deleted)</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
