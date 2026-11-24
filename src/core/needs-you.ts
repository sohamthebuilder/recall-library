import { desc, eq } from "drizzle-orm";
import { sources, topics } from "@/db/schema";
import type { CoreDeps } from "./core";
import { sourceDisplayName } from "./source-display";
import { sourceNameColumns, topicsAwaitingApprovalBySource } from "./sources";
import { pendingSuggestedEditCounts } from "./suggested-edits";

/** Everything waiting for the learner to decide or fix, each linking to where it is resolved. */
export interface NeedsYou {
  /** Sources whose proposed Topics wait to be approved, merged or rejected; newest Source first. */
  topicsToApprove: { source: { id: string; name: string }; count: number }[];
  /** Topics with pending Suggested Edits, by Topic name. */
  suggestedEdits: { topic: { id: string; name: string }; count: number }[];
  /** Sources that failed to process; newest first. */
  failedSources: { source: { id: string; name: string }; failureReason: string | null }[];
  /** Proposed Topics + Suggested Edits + failed Sources: the count shown in the nav. */
  total: number;
}

/** What waits for the learner now, for Today and the nav count. Reads no Source text beyond a Note's start. */
export async function needsYou(deps: CoreDeps): Promise<NeedsYou> {
  const [awaiting, editCounts, sourceRows, topicRows] = await Promise.all([
    topicsAwaitingApprovalBySource(deps),
    pendingSuggestedEditCounts(deps),
    deps.db
      .select({ id: sources.id, ...sourceNameColumns, status: sources.status, failureReason: sources.failureReason })
      .from(sources)
      .orderBy(desc(sources.addedAt)),
    deps.db.select({ id: topics.id, name: topics.name }).from(topics),
  ]);

  const named = (row: (typeof sourceRows)[number]) => ({ id: row.id, name: sourceDisplayName(row) });
  const topicsToApprove = sourceRows
    .filter((row) => awaiting.has(row.id))
    .map((row) => ({ source: named(row), count: awaiting.get(row.id)! }));
  const failedSources = sourceRows
    .filter((row) => row.status === "failed")
    .map((row) => ({ source: named(row), failureReason: row.failureReason }));
  const suggestedEdits = topicRows
    .filter((row) => editCounts[row.id])
    .map((row) => ({ topic: row, count: editCounts[row.id]! }))
    .sort((a, b) => a.topic.name.localeCompare(b.topic.name));

  const total =
    topicsToApprove.reduce((n, x) => n + x.count, 0) +
    suggestedEdits.reduce((n, x) => n + x.count, 0) +
    failedSources.length;
  return { topicsToApprove, suggestedEdits, failedSources, total };
}
