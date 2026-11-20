import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/core";
import { getCore } from "@/server/core";
import { deleteTopic } from "../../actions";
import { DeleteTopicButton } from "./delete-topic-button";
import { untitled } from "../../source-kind";
import { LinkSourceForm } from "./link-source-form";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let topic;
  try {
    topic = await getCore().topic(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const linked = new Set(topic.sources.map((s) => s.id));
  const linkable = (await getCore().library()).sources
    .filter((s) => !linked.has(s.id))
    .map((s) => ({ id: s.id, title: s.title ?? "Untitled Source" }));

  return (
    <div className="two-column wide-right">
      <section className="panel" aria-labelledby="topic-name">
        <p className="muted" style={{ margin: "0 0 8px" }}>
          <Link href="/topics">← Topics</Link>
        </p>
        <h2 id="topic-name">{topic.name}</h2>
        {topic.description ? <p className="muted">{topic.description}</p> : null}
        <form action={deleteTopic.bind(null, topic.id)}>
          <DeleteTopicButton name={topic.name} />
        </form>
      </section>

      <section aria-labelledby="topic-sources">
        <h2 id="topic-sources" style={{ marginTop: 0 }}>
          Sources
        </h2>
        {topic.sources.length === 0 ? (
          <p className="muted">Waiting for a Source.</p>
        ) : (
          <ul className="source-list">
            {topic.sources.map((source) => (
              <li key={source.id} className="panel source-item">
                <h3>
                  <Link href={`/sources/${source.id}`}>{source.title ?? untitled(source.kind)}</Link>
                </h3>
                <div className="source-meta">
                  Note · added{" "}
                  <time dateTime={source.addedAt.toISOString()}>{dateFormat.format(source.addedAt)}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
        <LinkSourceForm topicId={topic.id} sources={linkable} />
      </section>
    </div>
  );
}
