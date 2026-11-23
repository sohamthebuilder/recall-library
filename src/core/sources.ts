import { desc, eq } from "drizzle-orm";
import { sources } from "@/db/schema";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { enqueueJob } from "./jobs";
import { markdownUpload } from "./source-kinds";
import { addUploadedSource, type UploadedFile } from "./uploads";
import { parseYouTubeVideoId, youTubeWatchUrl } from "./youtube";

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
  /** When the text was captured. Null until it has been captured. */
  capturedAt: Date | null;
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
  /** A blog or article link. Its text is captured while processing. */
  | { kind: "url"; title?: string | null; url: string }
  /** A YouTube video link; its title and transcript are captured while processing. */
  | { kind: "youtube"; url: string }
  | { kind: "markdown"; file: UploadedFile };

type NewSource = Pick<typeof sources.$inferInsert, "kind" | "title" | "reference" | "text">;

/** Validate the input and work out the new Source's row. One case per Source kind (uploads aside). */
function newSource(input: Exclude<AddSourceInput, { kind: "markdown" }>): NewSource {
  switch (input.kind) {
    case "note": {
      const text = input.text.trim();
      if (!text) throw new ValidationError("A Note needs some text.");
      return { kind: "note", title: input.title?.trim() || null, reference: null, text };
    }
    case "url":
      return { kind: "url", title: input.title?.trim() || null, reference: normalizeWebUrl(input.url), text: null };
    case "youtube": {
      const videoId = parseYouTubeVideoId(input.url);
      if (!videoId) throw new ValidationError("That isn't a YouTube video link.");
      return { kind: "youtube", title: null, reference: youTubeWatchUrl(videoId), text: null };
    }
  }
}

/**
 * The http(s) link the learner meant, or a ValidationError. A link typed without a scheme
 * ("blog.example.com/post") is taken as https.
 */
export function normalizeWebUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ValidationError("Enter the link to the article.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ValidationError("That doesn't look like a web link.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) {
    throw new ValidationError("That doesn't look like a web link.");
  }
  return url.toString();
}

/** Add a Source and start processing it in the background. It begins `pending`. */
export async function addSource(deps: CoreDeps, input: AddSourceInput): Promise<Source> {
  if (input.kind === "markdown") return addUploadedSource(deps, input.file, markdownUpload);
  const values = newSource(input);
  const now = deps.clock.now();

  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(sources)
      .values({ ...values, addedAt: now, status: "pending" })
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

/**
 * Delete a Source: its chunks, Topic links and proposals go with it. Explainers are never
 * changed (ADR 0001); their citations to it read as "Source removed".
 */
export async function deleteSource(deps: CoreDeps, sourceId: string): Promise<void> {
  const row = await sourceRow(deps, sourceId);
  await deps.db.delete(sources).where(eq(sources.id, sourceId));
  if (row.fileKey) {
    try {
      await deps.fileStore.delete(row.fileKey);
    } catch {
      // The Source is already gone; a file left behind in the store is harmless to the learner.
    }
  }
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
    capturedAt: row.capturedAt,
    status: row.status,
    failureReason: row.failureReason,
  };
}
