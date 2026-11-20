import { and, asc, cosineDistance, eq, inArray } from "drizzle-orm";
import { sourceChunks } from "@/db/schema";
import type { ChunkAnchor } from "./chunking";
import type { CoreDeps } from "./core";
import { sourceRow } from "./sources";

export interface SourceChunk {
  id: string;
  sourceId: string;
  /** Position within the Source, from 0. */
  ordinal: number;
  text: string;
  anchor: ChunkAnchor;
}

const chunkColumns = {
  id: sourceChunks.id,
  sourceId: sourceChunks.sourceId,
  ordinal: sourceChunks.ordinal,
  text: sourceChunks.text,
  anchor: sourceChunks.anchor,
};

/** A Source's chunks in order. Empty until the Source has been processed. */
export async function chunksOfSource(deps: CoreDeps, sourceId: string): Promise<SourceChunk[]> {
  await sourceRow(deps, sourceId);
  const rows = await deps.db
    .select(chunkColumns)
    .from(sourceChunks)
    .where(eq(sourceChunks.sourceId, sourceId))
    .orderBy(asc(sourceChunks.ordinal));
  return rows as SourceChunk[];
}

/**
 * The chunks whose embeddings are nearest the text's, most similar first, optionally only
 * from some Sources. Used to pick the passages an Explainer is built from and cites.
 */
export async function similarChunks(
  deps: CoreDeps,
  input: { text: string; limit?: number; sourceIds?: string[] },
): Promise<SourceChunk[]> {
  if (input.sourceIds && input.sourceIds.length === 0) return [];
  const [embedding] = await deps.ai.embed([input.text]);
  const distance = cosineDistance(sourceChunks.embedding, embedding!);
  const rows = await deps.db
    .select(chunkColumns)
    .from(sourceChunks)
    .where(and(input.sourceIds ? inArray(sourceChunks.sourceId, input.sourceIds) : undefined))
    .orderBy(distance)
    .limit(input.limit ?? 8);
  return rows as SourceChunk[];
}
