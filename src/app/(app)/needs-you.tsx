import Link from "next/link";
import type { NeedsYou } from "@/core";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Today's inbox: everything waiting for a decision, each linking to where it is resolved. */
export function NeedsYouPanel({ needs }: { needs: NeedsYou }) {
  return (
    <section className="panel" aria-labelledby="needs-you">
      <h2 id="needs-you">
        Needs you {needs.total > 0 ? <span className="nav-badge">{needs.total}</span> : null}
      </h2>
      {needs.total === 0 ? (
        <p className="muted">Nothing is waiting for you.</p>
      ) : (
        <ul className="inbox">
          {needs.topicsToApprove.map(({ source, count }) => (
            <li key={`approve-${source.id}`}>
              <Link href={`/sources/${source.id}#proposed-topics`} className="inbox-item">
                <span className="inbox-kind">Topics to approve</span>
                <span className="inbox-title">{source.name}</span>
                <span className="inbox-detail">{plural(count, "proposed Topic", "proposed Topics")} waiting</span>
              </Link>
            </li>
          ))}
          {needs.suggestedEdits.map(({ topic, count }) => (
            <li key={`edit-${topic.id}`}>
              <Link href={`/topics/${topic.id}#suggested-edits`} className="inbox-item">
                <span className="inbox-kind">Suggested Edits</span>
                <span className="inbox-title">{topic.name}</span>
                <span className="inbox-detail">{plural(count, "Suggested Edit", "Suggested Edits")} to accept or reject</span>
              </Link>
            </li>
          ))}
          {needs.failedSources.map(({ source, failureReason }) => (
            <li key={`failed-${source.id}`}>
              <Link href={`/sources/${source.id}`} className="inbox-item is-failed">
                <span className="inbox-kind">Failed</span>
                <span className="inbox-title">{source.name}</span>
                <span className="inbox-detail">{failureReason ?? "This Source could not be processed."} Retry or delete it.</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
