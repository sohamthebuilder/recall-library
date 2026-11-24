import Link from "next/link";
import { isSourceProcessing } from "@/core";
import { getCore } from "@/server/core";
import { DueBanner } from "./due-banner";
import { NeedsYouPanel } from "./needs-you";
import { SourceList } from "./source-list";
import { RefreshWhileProcessing } from "./source-status";

export const dynamic = "force-dynamic";

const RECENT = 5;

/** Today: what's due, what needs you, and what you added lately. */
export default async function TodayPage() {
  const core = getCore();
  const [{ sources }, needs] = await Promise.all([core.library(), core.needsYou()]);
  const recent = sources.slice(0, RECENT);

  return (
    <div className="today">
      <RefreshWhileProcessing active={recent.some((s) => isSourceProcessing(s.status))} />
      <h1 className="page-title">Today</h1>
      <DueBanner />
      <NeedsYouPanel needs={needs} />
      <section aria-labelledby="recent-sources">
        <div className="row-between">
          <h2 id="recent-sources" className="section-title">
            Recently added
          </h2>
          {sources.length > RECENT ? <Link href="/library">All {sources.length} Sources →</Link> : null}
        </div>
        {recent.length === 0 ? (
          <p className="muted">
            Nothing here yet. <Link href="/add">Add a link, a Note or a file</Link> to start your Library.
          </p>
        ) : (
          <SourceList sources={recent} />
        )}
      </section>
    </div>
  );
}
