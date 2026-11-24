import Link from "next/link";
import { isSourceProcessing } from "@/core";
import { getCore } from "@/server/core";
import { SourceList } from "../source-list";
import { RefreshWhileProcessing } from "../source-status";

export const dynamic = "force-dynamic";

/** Every Source the learner has added, newest first. */
export default async function LibraryPage() {
  const { sources } = await getCore().library();

  return (
    <>
      <RefreshWhileProcessing active={sources.some((s) => isSourceProcessing(s.status))} />
      <div className="row-between page-head">
        <h1 className="page-title">Library</h1>
        <Link href="/add" className="button-link">
          + Add
        </Link>
      </div>
      {sources.length === 0 ? (
        <p className="muted">
          Nothing here yet. <Link href="/add">Add a link, a Note or a file</Link> to start your Library.
        </p>
      ) : (
        <SourceList sources={sources} />
      )}
    </>
  );
}
