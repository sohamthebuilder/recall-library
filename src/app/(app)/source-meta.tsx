import type { Source } from "@/core";
import { sourceDisplayName, sourceKindLabel } from "@/core/source-display";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** The name shown for a Source: its title, else its reference, else a placeholder. */
export const sourceDisplayTitle = (source: Source): string => sourceDisplayName(source);

/** Kind, original link (for web Sources), and when the Source was added and captured. */
export function SourceMeta({ source }: { source: Source }) {
  const isLink = source.reference && /^https?:\/\//.test(source.reference);
  const capturedOtherDay =
    source.capturedAt && dateFormat.format(source.capturedAt) !== dateFormat.format(source.addedAt);
  return (
    <div className="source-meta">
      {sourceKindLabel(source.kind)} · added <time dateTime={source.addedAt.toISOString()}>{dateFormat.format(source.addedAt)}</time>
      {source.capturedAt && (source.kind !== "note" || capturedOtherDay) ? (
        <>
          {" "}
          · captured{" "}
          <time dateTime={source.capturedAt.toISOString()}>{dateFormat.format(source.capturedAt)}</time>
        </>
      ) : null}
      {isLink ? (
        <div className="source-link">
          <a href={source.reference!} target="_blank" rel="noopener noreferrer">
            {source.reference}
          </a>
        </div>
      ) : null}
    </div>
  );
}
