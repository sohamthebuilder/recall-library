import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError, sourceDisplayName, sourceKindLabel } from "@/core";
import { getCore } from "@/server/core";
import { deleteTopic, untagTopic } from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { MoreMenu } from "../../more-menu";
import { PracticeButton } from "../../practice/practice-button";
import { AddTagForm } from "./add-tag-form";
import { ExplainerPanel } from "./explainer-panel";
import { LinkSourceForm } from "./link-source-form";
import { RecallPromptsPanel } from "./recall-prompts-panel";
import { ReviewHistory } from "./review-history";
import { SuggestedEditFailures } from "./suggested-edit-failures";
import { SuggestedEditsPanel } from "./suggested-edits-panel";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/**
 * A Topic: its Explainer first and widest; Sources, Recall Prompts and Review history in a
 * side column. Practice is the one visible action; deleting sits in a "⋯" menu.
 */
export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const core = getCore();
  let topic, explainer, prompts;
  try {
    [topic, explainer, prompts] = await Promise.all([core.topic(id), core.explainer(id), core.recallPrompts(id)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [allTags, suggestedEdits, suggestedEditFailures, library] = await Promise.all([
    core.tags(),
    core.suggestedEdits(topic.id),
    core.suggestedEditFailures(topic.id),
    core.library(),
  ]);
  const linked = new Set(topic.sources.map((s) => s.id));
  const linkable = library.sources.filter((s) => !linked.has(s.id)).map((s) => ({ id: s.id, title: sourceDisplayName(s) }));

  return (
    <>
      <header className="topic-header">
        <p className="muted back-link">
          <Link href="/topics">← Topics</Link>
        </p>
        <div className="topic-title-row">
          <div className="topic-title">
            <h1 id="topic-name">{topic.name}</h1>
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
              <li>
                <AddTagForm topicId={topic.id} existingTags={allTags.map((t) => t.name)} />
              </li>
            </ul>
          </div>
          <div className="button-row topic-actions">
            <PracticeButton scope={{ topicId: topic.id }} label="Practice" primary />
            <MoreMenu label="More actions for this Topic">
              <form action={deleteTopic.bind(null, topic.id)}>
                <ConfirmButton
                  label="Delete Topic"
                  pendingLabel="Deleting…"
                  confirmMessage={`Delete the Topic “${topic.name}”? Its Recall Prompts and Review history go too; its Sources stay in your Library.`}
                />
              </form>
            </MoreMenu>
          </div>
        </div>
        {topic.description ? <p className="muted topic-description">{topic.description}</p> : null}
        {suggestedEdits.length > 0 ? (
          <p className="notice">
            {suggestedEdits.length === 1 ? "1 Suggested Edit waits" : `${suggestedEdits.length} Suggested Edits wait`} for
            you. <a href="#suggested-edits">Review them ↓</a>
          </p>
        ) : null}
      </header>

      <div className="topic-layout">
        <div className="topic-main">
          <ExplainerPanel topicId={topic.id} explainer={explainer} />
          <SuggestedEditFailures topicId={topic.id} failures={suggestedEditFailures} />
          <SuggestedEditsPanel topicId={topic.id} edits={suggestedEdits} />
        </div>

        <aside className="topic-aside">
          <section aria-labelledby="topic-sources">
            <h2 id="topic-sources" className="aside-heading">
              Sources <span className="aside-count">{topic.sources.length}</span>
            </h2>
            {topic.sources.length === 0 ? (
              <p className="muted">Waiting for a Source.</p>
            ) : (
              <ul className="compact-list">
                {topic.sources.map((source) => (
                  <li key={source.id}>
                    <Link href={`/sources/${source.id}`}>{sourceDisplayName(source)}</Link>
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
          <RecallPromptsPanel topicId={topic.id} explainer={explainer} prompts={prompts} />
          <ReviewHistory topicId={topic.id} />
        </aside>
      </div>
    </>
  );
}
