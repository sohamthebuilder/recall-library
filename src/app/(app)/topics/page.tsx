import Link from "next/link";
import { getCore } from "@/server/core";
import { PracticeButton } from "../practice/practice-button";
import { ImportTopicsForm } from "./import-topics-form";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export default async function TopicsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = asList(params.q)[0]?.trim() ?? "";
  const tagIds = asList(params.tag).filter(Boolean);
  const filtering = search !== "" || tagIds.length > 0;

  const core = getCore();
  const [topics, allTags] = await Promise.all([core.findTopics({ search, tagIds }), core.tags()]);

  return (
    <section aria-labelledby="topics">
      <h2 id="topics" style={{ marginTop: 0 }}>
        Topics
      </h2>
      <details className="panel" open={!filtering && topics.length === 0} style={{ marginBottom: 16 }}>
        <summary>Add Topics from a list</summary>
        <ImportTopicsForm />
      </details>

      <form method="get" action="/topics" className="panel topic-filter" role="search">
        <label htmlFor="topic-search">Search by name</label>
        <input id="topic-search" name="q" type="search" defaultValue={search} autoComplete="off" />
        {allTags.length > 0 ? (
          <fieldset className="tag-filter">
            <legend>Tags (Topics with all checked)</legend>
            {allTags.map((tag) => (
              <label key={tag.id} className="tag-option">
                <input type="checkbox" name="tag" value={tag.id} defaultChecked={tagIds.includes(tag.id)} />
                {tag.name} <span className="muted">({tag.topicCount})</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="button-row">
          <button type="submit" className="primary">
            Find
          </button>
          {filtering ? <Link href="/topics">Clear</Link> : null}
        </div>
      </form>

      {tagIds.length === 1 && search === "" && topics.length > 0 ? (
        <PracticeButton
          scope={{ tagId: tagIds[0]! }}
          label={`Practise ${allTags.find((t) => t.id === tagIds[0])?.name ?? "this Tag"}`}
        />
      ) : null}
      {topics.length === 0 ? (
        <p className="muted">
          {filtering
            ? "No Topics match."
            : "No Topics yet. Paste a list above, or add a Source and approve the Topics it proposes."}
        </p>
      ) : (
        <ul className="topic-grid">
          {topics.map((topic) => (
            <li key={topic.id} className="panel">
              <h3>
                <Link href={`/topics/${topic.id}`}>{topic.name}</Link>
              </h3>
              {topic.description ? <p className="muted">{topic.description}</p> : null}
              {topic.tags.length > 0 ? (
                <ul className="tag-list" aria-label="Tags">
                  {topic.tags.map((tag) => (
                    <li key={tag.id} className="tag">
                      <Link href={`/topics?tag=${tag.id}`}>{tag.name}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="source-meta">
                {topic.sourceCount === 0
                  ? "Waiting for a Source"
                  : `${topic.sourceCount} Source${topic.sourceCount === 1 ? "" : "s"}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
