import type { CoreDeps } from "./core";
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

export const sourceKindHandlers: Partial<Record<SourceKind, SourceKindHandler>> = {
  note,
};
