/**
 * Content fetcher adapter: turns an external reference into captured text.
 * Real implementations arrive with the blog URL, YouTube, PDF and .md tickets.
 * Fake: src/adapters/fakes/fake-content-fetcher.ts.
 */
export interface FetchedArticle {
  title: string | null;
  text: string;
}

export interface ContentFetcher {
  /** Extract the readable text of an article at a URL. Throws ContentFetchError on failure. */
  fetchArticle(url: string): Promise<FetchedArticle>;
}

export class ContentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentFetchError";
  }
}
