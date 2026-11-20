import { desc, eq } from "drizzle-orm";
import { sources } from "@/db/schema";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { enqueueJob } from "./jobs";
import { markdownUpload } from "./source-kinds";
import { addUploadedSource, type UploadedFile } from "./uploads";

export type SourceKind = "url" | "youtube" | "pdf" | "markdown" | "note";

import type { SourceStatus } from "./source-status";
export type { SourceStatus };

export type SourceRow = typeof sources.$inferSelect;

export interface Source {
  id: string;
  kind: SourceKind;
  title: string | null;
  reference: string | null;
  /** The text captured from the Source. Null until it has been captured. */
  text: string | null;
  addedAt: Date;
  status: SourceStatus;
  /** Why processing failed, when status is `failed`. Safe to show the learner. */
  failureReason: string | null;
}

export interface Library {
  /** Newest first. */
  sources: Source[];
}

export type AddSourceInput =
  | { kind: "note"; title?: string | null; text: string }
  | { kind: "markdown"; file: UploadedFile };

/** Add a Source and start processing it in the background. It begins `pending`. */
export async function addSource(deps: CoreDeps, input: AddSourceInput): Promise<Source> {
  if (input.kind === "markdown") return addUploadedSource(deps, input.file, markdownUpload);
  const text = input.text.trim();
  if (!text) throw new ValidationError("A Note needs some text.");
  const title = input.title?.trim() || null;
  const now = deps.clock.now();

  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(sources)
      .values({ kind: "note", title, reference: null, text, addedAt: now, status: "pending" })
      .returning();
    await enqueueJob(tx, now, "process_source", { sourceId: row!.id });
    return toSource(row!);
  });
}

export async function library(deps: CoreDeps): Promise<Library> {
  const rows = await deps.db.select().from(sources).orderBy(desc(sources.addedAt));
  return { sources: rows.map(toSource) };
}

export async function getSource(deps: CoreDeps, sourceId: string): Promise<Source> {
  return toSource(await sourceRow(deps, sourceId));
}

/** Process a failed Source again from the start. */
export async function retrySource(deps: CoreDeps, sourceId: string): Promise<Source> {
  const row = await sourceRow(deps, sourceId);
  if (row.status !== "failed") throw new ValidationError("Only a Source that failed can be retried.");
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(sources)
      .set({ status: "pending", failureReason: null })
      .where(eq(sources.id, sourceId))
      .returning();
    await enqueueJob(tx, now, "process_source", { sourceId });
    return toSource(updated!);
  });
}

export async function sourceRow(deps: CoreDeps, sourceId: string): Promise<SourceRow> {
  const [row] = await deps.db.select().from(sources).where(eq(sources.id, sourceId));
  if (!row) throw new NotFoundError("That Source no longer exists.");
  return row;
}

export function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    reference: row.reference,
    text: row.text,
    addedAt: row.addedAt,
    status: row.status,
    failureReason: row.failureReason,
  };
}
