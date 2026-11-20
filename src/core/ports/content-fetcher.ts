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

export interface ContentFetcher {
  /** Extract the readable text of an article at a URL. Throws ContentFetchError on failure. */
  fetchArticle(url: string): Promise<FetchedArticle>;
  /**
   * Fetch a YouTube video's title and transcript (captions, manual or auto-generated).
   * Resolves null when the video has no transcript available; throws ContentFetchError
   * for any other failure (video missing or private, YouTube unreachable).
   */
  fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscript | null>;
}

export class ContentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentFetchError";
  }
}
