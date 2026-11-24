import Link from "next/link";
import type { LibrarySource } from "@/core";
import { SourceMeta, sourceDisplayTitle } from "./source-meta";
import { StatusBadge } from "./source-status";

/** Sources as cards: name, status (including Topics waiting for approval), a preview and when added. */
export function SourceList({ sources }: { sources: LibrarySource[] }) {
  return (
    <ul className="source-list">
      {sources.map((source) => (
        <li key={source.id} className="panel source-item">
          <div className="row-between">
            <h3>
              <Link href={`/sources/${source.id}`}>{sourceDisplayTitle(source)}</Link>
            </h3>
            <StatusBadge status={source.status} awaitingApproval={source.topicsAwaitingApproval} />
          </div>
          {source.text ? <p className="clamp">{source.text}</p> : null}
          {source.status === "failed" && source.failureReason ? <p className="error">{source.failureReason}</p> : null}
          <SourceMeta source={source} />
        </li>
      ))}
    </ul>
  );
}
