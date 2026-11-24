import Link from "next/link";
import { isSourceProcessing, type LibrarySource, type SourceKind, sourceKindLabel } from "@/core";
import { getCore } from "@/server/core";
import { sourceDisplayTitle } from "../source-meta";
import { RefreshWhileProcessing, StatusBadge } from "../source-status";

export const dynamic = "force-dynamic";

const KINDS: SourceKind[] = ["url", "youtube", "pdf", "markdown", "note"];
const STATUSES = [
  { value: "processing", label: "Processing" },
  { value: "needs_approval", label: "Needs approval" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
] as const;
type StatusFilter = (typeof STATUSES)[number]["value"];

/** The status a Source shows: Topics waiting for approval come before plain Ready. */
function statusOf(source: LibrarySource): StatusFilter {
  if (isSourceProcessing(source.status)) return "processing";
  if (source.status === "failed") return "failed";
  return source.topicsAwaitingApproval > 0 ? "needs_approval" : "ready";
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** Every Source the learner has added, newest first, filterable by kind and status. */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string }> }) {
  const params = await searchParams;
  const kind = KINDS.find((k) => k === params.kind);
  const status = STATUSES.find((s) => s.value === params.status)?.value;
  const { sources: all } = await getCore().library();
  const sources = all.filter((s) => (!kind || s.kind === kind) && (!status || statusOf(s) === status));
  const filtering = Boolean(kind || status);

  return (
    <>
      <RefreshWhileProcessing active={all.some((s) => isSourceProcessing(s.status))} />
      <div className="row-between page-head">
        <h1 className="page-title">
          Library <span className="aside-count">{all.length} Sources</span>
        </h1>
        <Link href="/add" className="button-link">
          + Add
        </Link>
      </div>

      <form method="get" action="/library" className="filter-row" role="search" aria-label="Filter Sources">
        <label>
          <span className="visually-hidden">Kind</span>
          <select name="kind" defaultValue={kind ?? ""}>
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {sourceKindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">Status</span>
          <select name="status" defaultValue={status ?? ""}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
        {filtering ? <Link href="/library">Clear</Link> : null}
      </form>

      {all.length === 0 ? (
        <p className="muted">
          Nothing here yet. <Link href="/add">Add a link, a Note or a file</Link> to start your Library.
        </p>
      ) : sources.length === 0 ? (
        <p className="muted">No Sources match.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Topics
              </th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <th scope="row" data-label="Title">
                  <Link href={`/sources/${source.id}`}>{sourceDisplayTitle(source)}</Link>
                </th>
                <td data-label="Kind">{sourceKindLabel(source.kind)}</td>
                <td data-label="Status">
                  <StatusBadge status={source.status} awaitingApproval={source.topicsAwaitingApproval} />
                </td>
                <td data-label="Topics" className="num">
                  {source.topicCount}
                </td>
                <td data-label="Added">
                  <time dateTime={source.addedAt.toISOString()}>{dateFormat.format(source.addedAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
