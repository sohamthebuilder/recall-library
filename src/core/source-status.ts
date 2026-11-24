// Dependency-free so client components can import it without pulling in the core.
export type SourceStatus = "pending" | "fetching" | "extracting" | "proposing_topics" | "ready" | "failed";

/** Still being processed in the background (neither ready nor failed). */
export function isSourceProcessing(status: SourceStatus): boolean {
  return status !== "ready" && status !== "failed";
}
