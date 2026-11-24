import {
  ContentFetchError,
  type ContentFetcher,
  type ExtractedPdf,
  type FetchedArticle,
  type YouTubeTranscript,
} from "@/core/ports/content-fetcher";

/** Deterministic content fetcher fake: only URLs scripted by the test resolve. */
export class FakeContentFetcher implements ContentFetcher {
  private readonly articles = new Map<string, FetchedArticle | { error: string }>();
  private readonly pdfs = new Map<string, ExtractedPdf | { error: string }>();
  private readonly transcripts = new Map<string, YouTubeTranscript | null | { error: string }>();
  private readonly hanging = new Set<string>();
  /** How many fetches of a hanging URL have started (none of them ever finishes). */
  hungFetches = 0;

  scriptArticle(url: string, article: FetchedArticle): this {
    this.hanging.delete(url);
    this.articles.set(url, article);
    return this;
  }

  scriptArticleFailure(url: string, reason: string): this {
    this.articles.set(url, { error: reason });
    return this;
  }

  /** Make fetching this URL never finish, as if the process running the job died mid-fetch. */
  scriptArticleHang(url: string): this {
    this.hanging.add(url);
    return this;
  }

  async fetchArticle(url: string): Promise<FetchedArticle> {
    if (this.hanging.has(url)) {
      this.hungFetches++;
      return new Promise<never>(() => {});
    }
    const scripted = this.articles.get(url);
    if (!scripted) throw new ContentFetchError(`FakeContentFetcher: no article scripted for ${url}`);
    if ("error" in scripted) throw new ContentFetchError(scripted.error);
    return scripted;
  }

  /** Script a video's transcript, or `null` for a video with no transcript available. */
  scriptYouTubeTranscript(videoId: string, transcript: YouTubeTranscript | null): this {
    this.transcripts.set(videoId, transcript);
    return this;
  }

  scriptYouTubeFailure(videoId: string, reason: string): this {
    this.transcripts.set(videoId, { error: reason });
    return this;
  }

  async fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscript | null> {
    const scripted = this.transcripts.get(videoId);
    if (scripted === undefined) throw new ContentFetchError(`FakeContentFetcher: no transcript scripted for ${videoId}`);
    if (scripted && "error" in scripted) throw new ContentFetchError(scripted.error);
    return scripted;
  }

  /** Script what `extractPdf` returns for a file whose bytes are exactly this (UTF-8) text. */
  scriptPdf(fileText: string, pdf: ExtractedPdf): this {
    this.pdfs.set(fileText, pdf);
    return this;
  }

  scriptPdfFailure(fileText: string, reason: string): this {
    this.pdfs.set(fileText, { error: reason });
    return this;
  }

  async extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
    const scripted = this.pdfs.get(new TextDecoder().decode(bytes));
    if (!scripted) throw new ContentFetchError("FakeContentFetcher: no PDF scripted for these bytes");
    if ("error" in scripted) throw new ContentFetchError(scripted.error);
    return scripted;
  }
}
