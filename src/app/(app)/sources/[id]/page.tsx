import Link from "next/link";
import { notFound } from "next/navigation";
import { isSourceProcessing, NotFoundError } from "@/core";
import { getCore } from "@/server/core";
import { retrySource } from "../../actions";
import { RefreshWhileProcessing, StatusBadge } from "../../source-status";
import { ProposalCard } from "./proposal-card";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

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
  const [proposals, topics] = await Promise.all([core.topicProposals(id), core.topics()]);
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
          <h2 id="source-title">{source.title ?? "Untitled Note"}</h2>
          <StatusBadge status={source.status} />
        </div>
        <div className="source-meta" style={{ marginBottom: 12 }}>
          Note · added <time dateTime={source.addedAt.toISOString()}>{dateFormat.format(source.addedAt)}</time>
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
        {source.text ? <p className="source-text">{source.text}</p> : null}
      </section>

      <section aria-labelledby="proposed-topics">
        <h2 id="proposed-topics" style={{ marginTop: 0 }}>
          Proposed Topics
        </h2>
        {isSourceProcessing(source.status) ? (
          <p className="muted">Topics will appear here once this Source has been read.</p>
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
