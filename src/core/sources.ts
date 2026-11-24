import { count, desc, eq, sql } from "drizzle-orm";
import { sources, topicProposals, topicSources } from "@/db/schema";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { enqueueJob } from "./jobs";
import { markdownUpload } from "./source-kinds";
import { pdfUpload } from "./pdf-sources";
import { addStoredUploadSource, addUploadedSource, type StoredUpload, type UploadedFile } from "./uploads";
import { parseYouTubeVideoId, youTubeWatchUrl } from "./youtube";

export type SourceKind = "url" | "youtube" | "pdf" | "markdown" | "note";

import type { SourceStatus } from "./source-status";
export type { SourceStatus };

export type SourceRow = typeof sources.$inferSelect;

/**
 * The columns sourceDisplayName needs, for selecting alongside other data. Only the start of
 * the text is read (a Note is named from its first heading or line), never a whole book.
 */
export const sourceNameColumns = {
  kind: sources.kind,
  title: sources.title,
  reference: sources.reference,
  text: sql<string | null>`left(${sources.text}, 2000)`,
};

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

/** A Source as listed in the Library. */
export interface LibrarySource extends Source {
  /** How many of its proposed Topics still wait for the learner to approve, merge or reject. */
  topicsAwaitingApproval: number;
  /** How many Topics draw on it. */
  topicCount: number;
}

export interface Library {
  /** Newest first. */
  sources: LibrarySource[];
}

export type AddSourceInput =
  | { kind: "note"; title?: string | null; text: string }
  /** A blog or article link. Its text is captured while processing. */
  | { kind: "url"; title?: string | null; url: string }
  /** A YouTube video link; its title and transcript are captured while processing. */
  | { kind: "youtube"; url: string }
  | { kind: "markdown"; file: UploadedFile }
  /**
   * A PDF (book or paper): either its bytes, or a file the browser already put in the file
   * store (large books). Its chapters are listed once it is read; see selectChapters.
   */
  | { kind: "pdf"; file: UploadedFile }
  | { kind: "pdf"; storedFile: StoredUpload };

type NewSource = Pick<typeof sources.$inferInsert, "kind" | "title" | "reference" | "text">;

/** Validate the input and work out the new Source's row. One case per Source kind (uploads aside). */
function newSource(input: Exclude<AddSourceInput, { kind: "markdown" | "pdf" }>): NewSource {
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
  if (input.kind === "pdf") {
    return "storedFile" in input
      ? addStoredUploadSource(deps, input.storedFile, pdfUpload)
      : addUploadedSource(deps, input.file, pdfUpload);
  }
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
  const [awaiting, linked] = await Promise.all([
    topicsAwaitingApprovalBySource(deps),
    deps.db.select({ sourceId: topicSources.sourceId, n: count() }).from(topicSources).groupBy(topicSources.sourceId),
  ]);
  const topicCounts = new Map(linked.map((r) => [r.sourceId, r.n]));
  return {
    sources: rows.map((row) => ({
      ...toSource(row),
      topicsAwaitingApproval: awaiting.get(row.id) ?? 0,
      topicCount: topicCounts.get(row.id) ?? 0,
    })),
  };
}

/** Pending Topic proposals per Source (only Sources that have some). */
export async function topicsAwaitingApprovalBySource(deps: CoreDeps): Promise<Map<string, number>> {
  const rows = await deps.db
    .select({ sourceId: topicProposals.sourceId, n: count() })
    .from(topicProposals)
    .where(eq(topicProposals.status, "pending"))
    .groupBy(topicProposals.sourceId);
  return new Map(rows.map((r) => [r.sourceId, r.n]));
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
