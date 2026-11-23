import { and, asc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { sourceChapters, sourceChunks, sources } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { ChunkAnchor } from "./chunking";
import type { CoreDeps } from "./core";
import { ValidationError } from "./errors";
import { enqueueJob } from "./jobs";
import { AiError } from "./ports/ai";
import { ContentFetchError, type ExtractedPdf, type PdfOutlineEntry } from "./ports/content-fetcher";
import { defineSourceKind, type Extraction } from "./source-kinds";
import { type SourceRow, sourceRow } from "./sources";
import { proposeTopicsForSource } from "./topics";
import { readUploadedFile, type UploadRule } from "./uploads";

/**
 * PDF Sources (books and papers). The whole text is captured page by page and chunked with
 * page anchors, and the PDF's chapters (its outline, or page ranges when it has none) are
 * listed. Topics are proposed only from the chapters the learner selects, one chapter at a
 * time, so a long book costs only what is being studied. More chapters can be selected later.
 */

/** A PDF without an outline is offered as page ranges of this many pages. */
export const PAGES_PER_RANGE = 20;

/** Largest PDF accepted. Big books go straight from the browser to the file store. */
const MAX_PDF_BYTES = 100 * 1024 * 1024;

export const pdfUpload: UploadRule = {
  kind: "pdf",
  extensions: [".pdf"],
  contentType: "application/pdf",
  maxBytes: MAX_PDF_BYTES,
  label: "a PDF",
  validate(bytes) {
    // Every PDF starts with "%PDF-" (some writers put a little junk before it).
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    if (!head.includes("%PDF-")) throw new ValidationError("That file isn't a PDF.");
  },
};

/** A chapter the learner can select, from the outline or a page range. */
export interface Chapter {
  id: string;
  title: string;
  /** 1-based, inclusive. */
  startPage: number;
  endPage: number;
  /**
   * `not_selected`: Topics not proposed from it yet; `proposing`: selected, Topics being proposed;
   * `proposed`: its Topic proposals are on the Source; `failed`: proposing failed (select it again).
   */
  status: ChapterStatus;
  failureReason: string | null;
}

export type ChapterStatus = "not_selected" | "proposing" | "proposed" | "failed";

interface PdfExtraction extends Extraction {
  pageCount: number;
  outline: PdfOutlineEntry[];
}

/** An uploaded PDF: read the file back, capture each page's text as one page-anchored segment. */
export const pdf = defineSourceKind<ExtractedPdf, PdfExtraction>({
  fetch: async (deps, source) => deps.contentFetcher.extractPdf((await readUploadedFile(deps, source)).bytes),
  extract: async (_deps, _source, extracted) => ({
    title: extracted.title,
    segments: extracted.pages
      .map((text, i) => ({ text: cleanPageText(text), page: i + 1 }))
      .filter((s) => s.text.length > 0),
    pageCount: extracted.pages.length,
    outline: extracted.outline,
  }),
  captured: async (tx, _now, source, extraction) => {
    // Retrying keeps the chapters (and what was selected) from the first time it was read.
    const existing = await tx.select({ id: sourceChapters.id }).from(sourceChapters).where(eq(sourceChapters.sourceId, source.id)).limit(1);
    if (existing.length) return;
    const chapters = chaptersOf(extraction.pageCount, extraction.outline);
    if (!chapters.length) return;
    await tx.insert(sourceChapters).values(chapters.map((c, ordinal) => ({ sourceId: source.id, ordinal, ...c })));
  },
  proposeTopics: (deps, source) => proposeFromSelectedChapters(deps, source),
});

function cleanPageText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The chapters of a PDF: one per top-level outline entry, running to the page before the next
 * one (pages before the first become "Front matter"); with no usable outline, page ranges.
 */
export function chaptersOf(
  pageCount: number,
  outline: PdfOutlineEntry[],
): { title: string; startPage: number; endPage: number }[] {
  if (pageCount < 1) return [];
  const starts: PdfOutlineEntry[] = [];
  for (const entry of outline) {
    const title = entry.title.replace(/\s+/g, " ").trim();
    if (!title || !Number.isInteger(entry.page) || entry.page < 1 || entry.page > pageCount) continue;
    // Entries out of order or sharing a page with the one before can't make a page range.
    if (starts.length && entry.page <= starts[starts.length - 1]!.page) continue;
    starts.push({ title, page: entry.page });
  }

  if (!starts.length) {
    const ranges = [];
    for (let start = 1; start <= pageCount; start += PAGES_PER_RANGE) {
      const end = Math.min(pageCount, start + PAGES_PER_RANGE - 1);
      ranges.push({ title: pageRangeTitle(start, end), startPage: start, endPage: end });
    }
    return ranges;
  }

  const chapters = [];
  if (starts[0]!.page > 1) chapters.push({ title: "Front matter", startPage: 1, endPage: starts[0]!.page - 1 });
  starts.forEach((entry, i) => {
    const next = starts[i + 1];
    chapters.push({ title: entry.title, startPage: entry.page, endPage: next ? next.page - 1 : pageCount });
  });
  return chapters;
}

function pageRangeTitle(start: number, end: number): string {
  return start === end ? `Page ${start}` : `Pages ${start}–${end}`;
}

// ---------------------------------------------------------------------------------------
// Reads and operations

/** A PDF Source's chapters in order. Empty for other kinds, and until the PDF has been read. */
export async function chaptersOfSource(deps: CoreDeps, sourceId: string): Promise<Chapter[]> {
  await sourceRow(deps, sourceId);
  return chapterRows(deps.db, sourceId);
}

async function chapterRows(db: DbOrTx, sourceId: string): Promise<Chapter[]> {
  const rows = await db
    .select()
    .from(sourceChapters)
    .where(eq(sourceChapters.sourceId, sourceId))
    .orderBy(asc(sourceChapters.ordinal));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startPage: r.startPage,
    endPage: r.endPage,
    status: r.topicsProposedAt ? "proposed" : r.selectedAt ? "proposing" : r.failureReason ? "failed" : "not_selected",
    failureReason: r.failureReason,
  }));
}

/**
 * Select chapters of a PDF to propose Topics from. Topics are proposed in the background,
 * chapter by chapter, and added to the Source's proposals. Chapters already proposed (or
 * being proposed) are left as they are; a failed chapter can be selected again.
 */
export async function selectChapters(
  deps: CoreDeps,
  input: { sourceId: string; chapterIds: string[] },
): Promise<Chapter[]> {
  const source = await sourceRow(deps, input.sourceId);
  if (source.kind !== "pdf") throw new ValidationError("Only a PDF has chapters to select.");
  if (source.status !== "ready" && source.status !== "proposing_topics") {
    throw new ValidationError(
      source.status === "failed"
        ? "This PDF couldn't be read. Retry it before selecting chapters."
        : "This PDF is still being read. Select chapters once it is ready.",
    );
  }
  if (!input.chapterIds.length) throw new ValidationError("Select at least one chapter.");

  const chapters = await chapterRows(deps.db, source.id);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  if (input.chapterIds.some((id) => !byId.has(id))) throw new ValidationError("That chapter isn't part of this PDF.");
  const toSelect = input.chapterIds.filter((id) => {
    const status = byId.get(id)!.status;
    return status === "not_selected" || status === "failed";
  });
  if (!toSelect.length) throw new ValidationError("Topics have already been proposed from those chapters.");

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(sourceChapters)
      .set({ selectedAt: now, failureReason: null })
      .where(and(eq(sourceChapters.sourceId, source.id), inArray(sourceChapters.id, toSelect)));
    await tx.update(sources).set({ status: "proposing_topics", failureReason: null }).where(eq(sources.id, source.id));
    await enqueueJob(tx, now, "propose_chapter_topics", { sourceId: source.id });
  });
  return chapterRows(deps.db, source.id);
}

/** The `propose_chapter_topics` job: propose from the selected chapters, then the PDF is ready again. */
export async function proposeChapterTopics(deps: CoreDeps, { sourceId }: { sourceId: string }): Promise<void> {
  let source;
  try {
    source = await sourceRow(deps, sourceId);
  } catch {
    return; // Deleted before its job ran.
  }
  try {
    await proposeFromSelectedChapters(deps, source);
  } finally {
    await deps.db
      .update(sources)
      .set({ status: "ready" })
      .where(and(eq(sources.id, sourceId), eq(sources.status, "proposing_topics")));
  }
}

const UNEXPECTED_CHAPTER_FAILURE = "Something went wrong while proposing Topics from this chapter. Select it again.";

/**
 * Propose Topics from each selected chapter not yet proposed from, in order. A chapter that
 * fails goes back to unselected with its reason; the others carry on.
 */
async function proposeFromSelectedChapters(deps: CoreDeps, source: SourceRow): Promise<void> {
  const waiting = await deps.db
    .select()
    .from(sourceChapters)
    .where(
      and(
        eq(sourceChapters.sourceId, source.id),
        isNotNull(sourceChapters.selectedAt),
        isNull(sourceChapters.topicsProposedAt),
      ),
    )
    .orderBy(asc(sourceChapters.ordinal));
  if (!waiting.length) return;

  const [{ text } = { text: null }] = await deps.db.select({ text: sources.text }).from(sources).where(eq(sources.id, source.id));
  const anchors = (
    await deps.db
      .select({ anchor: sourceChunks.anchor })
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceId, source.id))
      .orderBy(asc(sourceChunks.ordinal))
  ).map((r) => r.anchor as ChunkAnchor);
  const bookTitle = source.title ?? source.reference ?? "PDF";

  let unexpected: unknown = null;
  for (const chapter of waiting) {
    try {
      const chapterText = textOfPages(text ?? "", anchors, chapter.startPage, chapter.endPage);
      if (chapterText) {
        await proposeTopicsForSource(deps, { id: source.id, title: `${bookTitle}: ${chapter.title}` }, chapterText, {
          keepPending: true,
        });
      }
      await deps.db
        .update(sourceChapters)
        .set({ topicsProposedAt: deps.clock.now() })
        .where(eq(sourceChapters.id, chapter.id));
    } catch (e) {
      const known = e instanceof AiError || e instanceof ContentFetchError;
      if (!known) unexpected ??= e;
      await deps.db
        .update(sourceChapters)
        .set({ selectedAt: null, failureReason: known ? e.message : UNEXPECTED_CHAPTER_FAILURE })
        .where(eq(sourceChapters.id, chapter.id));
    }
  }
  if (unexpected) throw unexpected; // Keep the details on the job for debugging.
}

/** The captured text of pages start..end: from the first chunk on them to the end of the last. */
function textOfPages(text: string, anchors: ChunkAnchor[], startPage: number, endPage: number): string {
  const onPages = anchors.filter((a) => a.page !== undefined && a.page >= startPage && a.page <= endPage);
  if (!onPages.length) return "";
  return text.slice(onPages[0]!.start, onPages[onPages.length - 1]!.end);
}
