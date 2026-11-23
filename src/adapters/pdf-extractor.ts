import { extractText, getDocumentProxy } from "unpdf";
import { ContentFetchError, type ExtractedPdf, type PdfOutlineEntry } from "@/core/ports/content-fetcher";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * Real PDF extraction (unpdf, a serverless build of PDF.js): each page's text, the metadata
 * title, and the top-level outline entries with the page each one points at.
 */
export function createPdfExtractor() {
  return {
    async extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
      let doc: PdfDocument;
      try {
        // PDF.js may take ownership of (detach) the buffer it is given, so hand it a copy.
        doc = await getDocumentProxy(new Uint8Array(bytes));
      } catch (e) {
        if (e instanceof Error && e.name === "PasswordException") {
          throw new ContentFetchError("This PDF is password-protected. Remove the password and upload it again.");
        }
        throw new ContentFetchError("This PDF couldn't be read. It may be damaged; try exporting it again.");
      }
      try {
        const { text } = await extractText(doc, { mergePages: false });
        const meta = await doc.getMetadata().catch(() => null);
        const info = meta?.info as { Title?: unknown } | undefined;
        const title = typeof info?.Title === "string" && info.Title.trim() ? info.Title.trim() : null;
        return { title, pages: text, outline: await topLevelOutline(doc) };
      } finally {
        await doc.cleanup().catch(() => {});
        await doc.loadingTask?.destroy().catch(() => {});
      }
    },
  };
}

async function topLevelOutline(doc: PdfDocument): Promise<PdfOutlineEntry[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline) return [];
  const entries: PdfOutlineEntry[] = [];
  for (const item of outline) {
    const page = await destinationPage(doc, item.dest);
    if (page !== null && item.title?.trim()) entries.push({ title: item.title.trim(), page });
  }
  return entries;
}

/** The 1-based page an outline destination points at, or null if it can't be resolved. */
async function destinationPage(doc: PdfDocument, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    const target = explicit?.[0];
    if (target === undefined || target === null) return null;
    if (typeof target === "number") return target + 1;
    return (await doc.getPageIndex(target as Parameters<PdfDocument["getPageIndex"]>[0])) + 1;
  } catch {
    return null;
  }
}
