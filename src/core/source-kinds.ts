import type { CoreDeps } from "./core";
import type { FetchedArticle } from "./ports/content-fetcher";
import { ValidationError } from "./errors";
import { readUploadedFile, type UploadRule } from "./uploads";
import type { SourceKind, SourceRow } from "./sources";

/**
 * A run of captured text with where it came from. Chunks cut from a segment inherit its
 * page or timestamp, so citations can point back into the original.
 */
export interface Segment {
  text: string;
  /** 1-based page number (PDF). */
  page?: number;
  /** Seconds from the start (YouTube). */
  seconds?: number;
}

export interface Extraction {
  /** A title found while extracting (e.g. the article's title). Only used if the Source has none. */
  title?: string | null;
  /** The captured text, in order. The Source's stored text is these joined by blank lines. */
  segments: Segment[];
}

/**
 * How one Source kind is captured. The processing pipeline (source-processing.ts) calls
 * `fetch` while the Source is `fetching`, `extract` while it is `extracting`, then chunks,
 * embeds and proposes Topics the same way for every kind.
 *
 * To add a Source kind: write a handler here, register it in `sourceKindHandlers`, and
 * extend AddSourceInput in sources.ts. Throw ContentFetchError (or AiError) with a message
 * the learner can act on; it becomes the Source's failure reason.
 */
export interface SourceKindHandler<Raw = unknown> {
  /** Get the raw material: download the page, read the stored file, fetch the transcript. */
  fetch(deps: CoreDeps, source: SourceRow): Promise<Raw>;
  /** Turn the raw material into anchored text. */
  extract(deps: CoreDeps, source: SourceRow, raw: Raw): Promise<Extraction>;
  /**
   * The part of the captured text to propose Topics from. Defaults to all of it; a PDF
   * narrows this to the chapters the learner selected.
   */
  proposalText?(deps: CoreDeps, source: SourceRow, extraction: Extraction): Promise<string>;
}

/** Helper that keeps a handler's Raw type consistent between fetch and extract. */
function defineSourceKind<Raw>(handler: SourceKindHandler<Raw>): SourceKindHandler {
  return handler as SourceKindHandler;
}

/** A Note's text is typed in, so there is nothing to fetch and one segment to extract. */
const note = defineSourceKind<string>({
  fetch: async (_deps, source) => source.text ?? "",
  extract: async (_deps, _source, text) => ({ segments: [{ text }] }),
});

/**
 * A blog or article link: the content fetcher downloads the page and extracts its readable
 * text, which is kept so citations survive the page changing or disappearing.
 */
const url = defineSourceKind<FetchedArticle>({
  fetch: async (deps, source) => deps.contentFetcher.fetchArticle(source.reference ?? ""),
  extract: async (_deps, _source, article) => ({ title: article.title, segments: [{ text: article.text }] }),
});

/** What a .md upload accepts. Markdown is kept as written: the Source's text is the file's text. */
export const markdownUpload: UploadRule = {
  kind: "markdown",
  extensions: [".md", ".markdown"],
  contentType: "text/markdown",
  maxBytes: 4 * 1024 * 1024,
  label: "a .md file",
  validate(bytes) {
    try {
      decodeUtf8(bytes);
    } catch {
      throw new ValidationError("That file isn't readable text. Save it as UTF-8 and upload it again.");
    }
  },
};

/** An uploaded .md file: read it back from the file store; its text is one segment. */
const markdown = defineSourceKind<string>({
  fetch: async (deps, source) => decodeUtf8((await readUploadedFile(deps, source)).bytes),
  extract: async (_deps, _source, text) => ({ segments: [{ text: text.replace(/\r\n?/g, "\n").trim() }] }),
});

/** Strict UTF-8 (throws on invalid bytes); a leading BOM is dropped. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export const sourceKindHandlers: Partial<Record<SourceKind, SourceKindHandler>> = {
  note,
  url,
  markdown,
};
