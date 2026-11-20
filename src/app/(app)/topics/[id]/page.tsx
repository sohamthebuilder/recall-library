import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError, sourceDisplayName, sourceKindLabel } from "@/core";
import { getCore } from "@/server/core";
import { deleteTopic, untagTopic } from "../../actions";
import { AddTagForm } from "./add-tag-form";
import { DeleteTopicButton } from "./delete-topic-button";
import { ExplainerPanel } from "./explainer-panel";
import { LinkSourceForm } from "./link-source-form";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const core = getCore();
  let topic, explainer;
  try {
    [topic, explainer] = await Promise.all([core.topic(id), core.explainer(id)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const allTags = await core.tags();
  const linked = new Set(topic.sources.map((s) => s.id));
  const linkable = (await core.library()).sources
    .filter((s) => !linked.has(s.id))
    .map((s) => ({ id: s.id, title: sourceDisplayName(s) }));

  return (
    <>
      <header className="topic-header">
        <p className="muted" style={{ margin: "0 0 4px" }}>
          <Link href="/topics">← Topics</Link>
        </p>
        <div className="row-between">
          <h2 id="topic-name">{topic.name}</h2>
          <form action={deleteTopic.bind(null, topic.id)}>
            <DeleteTopicButton name={topic.name} />
          </form>
        </div>
        {topic.description ? <p className="muted">{topic.description}</p> : null}
        <h3 className="subheading">Tags</h3>
        {topic.tags.length === 0 ? (
          <p className="muted">No Tags yet.</p>
        ) : (
          <ul className="tag-list" aria-label="Tags">
            {topic.tags.map((tag) => (
              <li key={tag.id} className="tag">
                <Link href={`/topics?tag=${tag.id}`}>{tag.name}</Link>
                <form action={untagTopic.bind(null, topic.id, tag.id)}>
                  <button type="submit" className="tag-remove" aria-label={`Remove Tag ${tag.name}`}>
                    ×
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <AddTagForm topicId={topic.id} existingTags={allTags.map((t) => t.name)} />

      </header>

      <div className="topic-layout">
        <ExplainerPanel topicId={topic.id} explainer={explainer} />

        <aside className="topic-aside">
          <section aria-labelledby="topic-sources">
            <h2 id="topic-sources" className="aside-heading">
              Sources
            </h2>
            {topic.sources.length === 0 ? (
              <p className="muted">Waiting for a Source.</p>
            ) : (
              <ul className="source-list">
                {topic.sources.map((source) => (
                  <li key={source.id} className="panel source-item">
                    <h3>
                      <Link href={`/sources/${source.id}`}>{sourceDisplayName(source)}</Link>
                    </h3>
                    <div className="source-meta">
                      {sourceKindLabel(source.kind)} · added{" "}
                      <time dateTime={source.addedAt.toISOString()}>{dateFormat.format(source.addedAt)}</time>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <LinkSourceForm topicId={topic.id} sources={linkable} />
          </section>
        </aside>
      </div>
    </>
  );
}
