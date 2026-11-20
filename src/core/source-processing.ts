import { eq } from "drizzle-orm";
import { sourceChunks, sources } from "@/db/schema";
import { chunkSegments, joinSegments } from "./chunking";
import type { CoreDeps } from "./core";
import { AiError } from "./ports/ai";
import { ContentFetchError } from "./ports/content-fetcher";
import { sourceKindHandlers } from "./source-kinds";
import { type SourceStatus, sourceRow } from "./sources";
import { proposeTopicsForSource } from "./topics";

/** Embedding requests are sent in batches of this many chunks. */
const EMBED_BATCH = 64;

export const UNEXPECTED_FAILURE_REASON = "Something went wrong while processing this Source. Try again.";

/**
 * The `process_source` job: pending → fetching → extracting → proposing_topics → ready,
 * or failed with a reason the learner can read. Safe to run again on the same Source
 * (retry): captured text, chunks and pending proposals are replaced, decided ones kept.
 */
export async function processSource(deps: CoreDeps, { sourceId }: { sourceId: string }): Promise<void> {
  let source;
  try {
    source = await sourceRow(deps, sourceId);
  } catch {
    return; // Deleted before its job ran: nothing to do.
  }
  if (source.status === "ready") return;

  try {
    const handler = sourceKindHandlers[source.kind];
    if (!handler) throw new Error(`No handler for Source kind "${source.kind}"`);

    await setStatus(deps, sourceId, "fetching");
    const raw = await handler.fetch(deps, source);

    await setStatus(deps, sourceId, "extracting");
    const extraction = await handler.extract(deps, source, raw);
    const text = joinSegments(extraction.segments);
    if (!text.trim()) throw new ContentFetchError("No text could be found in this Source.");
    const title = source.title ?? extraction.title?.trim() ?? null;
    const chunks = chunkSegments(extraction.segments);
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      embeddings.push(...(await deps.ai.embed(chunks.slice(i, i + EMBED_BATCH).map((c) => c.text))));
    }
    await deps.db.transaction(async (tx) => {
      await tx.update(sources).set({ text, title }).where(eq(sources.id, sourceId));
      await tx.delete(sourceChunks).where(eq(sourceChunks.sourceId, sourceId));
      if (chunks.length) {
        await tx.insert(sourceChunks).values(
          chunks.map((c, i) => ({
            sourceId,
            ordinal: i,
            text: c.text,
            anchor: c.anchor,
            embedding: embeddings[i]!,
          })),
        );
      }
    });

    await setStatus(deps, sourceId, "proposing_topics");
    const captured = { ...source, text, title };
    const proposalText = handler.proposalText ? await handler.proposalText(deps, captured, extraction) : text;
    await proposeTopicsForSource(deps, captured, proposalText);

    await setStatus(deps, sourceId, "ready");
  } catch (e) {
    const known = e instanceof ContentFetchError || e instanceof AiError;
    await deps.db
      .update(sources)
      .set({ status: "failed", failureReason: known ? e.message : UNEXPECTED_FAILURE_REASON })
      .where(eq(sources.id, sourceId));
    if (!known) throw e; // Keep the details on the job for debugging.
  }
}

async function setStatus(deps: CoreDeps, sourceId: string, status: SourceStatus) {
  await deps.db.update(sources).set({ status, failureReason: null }).where(eq(sources.id, sourceId));
}
