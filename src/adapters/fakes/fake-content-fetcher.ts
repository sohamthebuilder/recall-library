import {
  ContentFetchError,
  type ContentFetcher,
  type FetchedArticle,
  type YouTubeTranscript,
} from "@/core/ports/content-fetcher";

/** Deterministic content fetcher fake: only URLs scripted by the test resolve. */
export class FakeContentFetcher implements ContentFetcher {
  private readonly articles = new Map<string, FetchedArticle | { error: string }>();
  private readonly transcripts = new Map<string, YouTubeTranscript | null | { error: string }>();

  scriptArticle(url: string, article: FetchedArticle): this {
    this.articles.set(url, article);
    return this;
  }

  scriptArticleFailure(url: string, reason: string): this {
    this.articles.set(url, { error: reason });
    return this;
  }

  async fetchArticle(url: string): Promise<FetchedArticle> {
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
}
