import Link from "next/link";
import type { TaggedTopicSummary, TopicMemory } from "@/core";
import { getCore } from "@/server/core";
import { learnerTimeZone } from "@/server/time-zone";
import { PracticeButton } from "../practice/practice-button";
import { ImportTopicsForm } from "./import-topics-form";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Sort = "name" | "due" | "reviewed" | "strength";
const SORTS: Sort[] = ["name", "due", "reviewed", "strength"];

const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

type Row = TaggedTopicSummary & { memory: TopicMemory | undefined };

/** Nulls (never reviewed, no prompts) always go last. */
function compare(a: Row, b: Row, sort: Sort): number {
  const byName = a.name.localeCompare(b.name);
  const last = (x: number | undefined, y: number | undefined) =>
    x === undefined && y === undefined ? 0 : x === undefined ? 1 : y === undefined ? -1 : x - y;
  switch (sort) {
    case "due":
      return last(a.memory?.nextDue.getTime(), b.memory?.nextDue.getTime()) || byName;
    case "reviewed": // most recent first
      return last(neg(a.memory?.lastReviewedAt?.getTime()), neg(b.memory?.lastReviewedAt?.getTime())) || byName;
    case "strength": // weakest first
      return last(a.memory?.strength ?? undefined, b.memory?.strength ?? undefined) || byName;
    default:
      return byName;
  }
}
const neg = (n: number | undefined) => (n === undefined ? undefined : -n);

export default async function TopicsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = asList(params.q)[0]?.trim() ?? "";
  const tagIds = asList(params.tag).filter(Boolean);
  const sort = SORTS.find((s) => s === asList(params.sort)[0]) ?? "name";
  const filtering = search !== "" || tagIds.length > 0;

  const core = getCore();
  const [topics, allTags, pendingEdits, memory] = await Promise.all([
    core.findTopics({ search, tagIds }),
    core.tags(),
    core.pendingSuggestedEditCounts(),
    core.topicMemory({ timeZone: learnerTimeZone() }),
  ]);
  const rows: Row[] = topics.map((t) => ({ ...t, memory: memory[t.id] })).sort((a, b) => compare(a, b, sort));
  const now = new Date();

  /** This page's URL with some parameters changed (null removes one). */
  const href = (change: { tags?: string[]; sort?: Sort }) => {
    const q = new URLSearchParams();
    if (search) q.set("q", search);
    for (const id of change.tags ?? tagIds) q.append("tag", id);
    const s = change.sort ?? sort;
    if (s !== "name") q.set("sort", s);
    const qs = q.toString();
    return qs ? `/topics?${qs}` : "/topics";
  };
  const sortHeader = (s: Sort, label: string) => (
    <th scope="col" aria-sort={sort === s ? (s === "reviewed" ? "descending" : "ascending") : undefined}>
      <Link href={href({ sort: s })} className={sort === s ? "sort-link active" : "sort-link"}>
        {label}
        {sort === s ? " ↓" : ""}
      </Link>
    </th>
  );
  const singleTag = tagIds.length === 1 ? allTags.find((t) => t.id === tagIds[0]) : undefined;

  return (
    <section aria-labelledby="topics">
      <div className="row-between page-head">
        <h1 id="topics" className="page-title">
          Topics <span className="aside-count">{topics.length}</span>
        </h1>
        {singleTag && search === "" && topics.length > 0 ? (
          <PracticeButton scope={{ tagId: singleTag.id }} label={`Practice ${singleTag.name}`} primary />
        ) : null}
      </div>

      <div className="topic-filters">
        <form method="get" action="/topics" className="filter-row" role="search" aria-label="Find Topics">
          {tagIds.map((id) => (
            <input key={id} type="hidden" name="tag" value={id} />
          ))}
          {sort !== "name" ? <input type="hidden" name="sort" value={sort} /> : null}
          <label htmlFor="topic-search" className="visually-hidden">
            Search by name
          </label>
          <input id="topic-search" name="q" type="search" defaultValue={search} autoComplete="off" placeholder="Search Topics by name" />
          <button type="submit">Search</button>
          {filtering ? <Link href="/topics">Clear</Link> : null}
        </form>
        <div className="tag-chips" aria-label="Filter by Tag">
          <span className="muted">Tags:</span>
          {allTags.length === 0 ? (
            <span className="muted">none yet. Add a Tag on a Topic&rsquo;s page to filter by it.</span>
          ) : (
            allTags.map((tag) => {
              const on = tagIds.includes(tag.id);
              return (
                <Link
                  key={tag.id}
                  href={href({ tags: on ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id] })}
                  className={on ? "chip active" : "chip"}
                  aria-pressed={on}
                >
                  {tag.name} <span className="chip-count">{tag.topicCount}</span>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          {filtering ? "No Topics match." : "No Topics yet. Add a list below, or add a Source and approve the Topics it proposes."}
        </p>
      ) : (
        <table className="data-table topics-table">
          <thead>
            <tr>
              {sortHeader("name", "Name")}
              <th scope="col">Tags</th>
              <th scope="col" className="num">
                Sources
              </th>
              {sortHeader("due", "Due")}
              {sortHeader("reviewed", "Last reviewed")}
              {sortHeader("strength", "Strength")}
            </tr>
          </thead>
          <tbody>
            {rows.map((topic) => (
              <tr key={topic.id}>
                <th scope="row" data-label="Name">
                  <Link href={`/topics/${topic.id}`}>{topic.name}</Link>
                  {topic.sourceCount === 0 ? <span className="badge">Waiting for a Source</span> : null}
                  {pendingEdits[topic.id] ? (
                    <span className="badge badge-needs">
                      {pendingEdits[topic.id]} Suggested Edit{pendingEdits[topic.id] === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </th>
                <td data-label="Tags">
                  {topic.tags.length === 0 ? (
                    <span className="muted">–</span>
                  ) : (
                    <span className="tag-inline">
                      {topic.tags.map((tag) => (
                        <Link key={tag.id} href={href({ tags: [tag.id] })} className="chip small">
                          {tag.name}
                        </Link>
                      ))}
                    </span>
                  )}
                </td>
                <td data-label="Sources" className="num">
                  {topic.sourceCount}
                </td>
                <td data-label="Due">
                  {!topic.memory ? (
                    <span className="muted">–</span>
                  ) : topic.memory.dueCount > 0 ? (
                    <strong>{topic.memory.dueCount} due</strong>
                  ) : (
                    dayFormat.format(topic.memory.nextDue)
                  )}
                </td>
                <td data-label="Last reviewed">
                  {topic.memory?.lastReviewedAt ? (
                    <time dateTime={topic.memory.lastReviewedAt.toISOString()}>{relativeDay(topic.memory.lastReviewedAt, now)}</time>
                  ) : (
                    <span className="muted">Never</span>
                  )}
                </td>
                <td data-label="Strength">
                  <Strength value={topic.memory?.strength ?? null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="panel import-topics" open={!filtering && topics.length === 0}>
        <summary>Add Topics from a list</summary>
        <ImportTopicsForm />
      </details>
    </section>
  );
}

function relativeDay(d: Date, now: Date): string {
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return dayFormat.format(d);
}

/** FSRS recall probability as a short bar and a percentage. */
function Strength({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">Not yet</span>;
  const pct = Math.round(value * 100);
  const level = pct >= 85 ? "strong" : pct >= 65 ? "fair" : "weak";
  return (
    <span className={`strength strength-${level}`} title={`About ${pct}% likely to recall now`}>
      <span className="strength-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
