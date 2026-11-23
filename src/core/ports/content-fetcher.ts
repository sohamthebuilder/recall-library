/**
 * Content fetcher adapter: turns an external reference into captured text.
 * Real implementations arrive with the blog URL, YouTube, PDF and .md tickets.
 * Fake: src/adapters/fakes/fake-content-fetcher.ts.
 */
export interface FetchedArticle {
  title: string | null;
  text: string;
}

/** One caption line of a video's transcript, starting `seconds` into the video. */
export interface TranscriptCue {
  seconds: number;
  text: string;
}

export interface YouTubeTranscript {
  title: string | null;
  /** In playback order. */
  cues: TranscriptCue[];
}

/** A top-level entry of a PDF's outline (bookmarks): a chapter title and the page it starts on. */
export interface PdfOutlineEntry {
  title: string;
  /** 1-based page number. */
  page: number;
}

export interface ExtractedPdf {
  /** The title in the PDF's metadata, if any. */
  title: string | null;
  /** The text of each page, in order (index 0 is page 1). A page with no text is "". */
  pages: string[];
  /** Top-level outline entries in document order; empty when the PDF has no outline. */
  outline: PdfOutlineEntry[];
}

export interface ContentFetcher {
  /** Extract the readable text of an article at a URL. Throws ContentFetchError on failure. */
  fetchArticle(url: string): Promise<FetchedArticle>;
  /**
   * Fetch a YouTube video's title and transcript (captions, manual or auto-generated).
   * Resolves null when the video has no transcript available; throws ContentFetchError
   * for any other failure (video missing or private, YouTube unreachable).
   */
  fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscript | null>;
  /**
   * Extract a PDF's text page by page and its top-level outline. Throws ContentFetchError
   * when the file can't be read (damaged, password-protected).
   */
  extractPdf(bytes: Uint8Array): Promise<ExtractedPdf>;
}

export class ContentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentFetchError";
  }
}
