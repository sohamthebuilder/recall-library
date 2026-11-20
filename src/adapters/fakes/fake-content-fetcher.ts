import { ContentFetchError, type ContentFetcher, type FetchedArticle } from "@/core/ports/content-fetcher";

/** Deterministic content fetcher fake: only URLs scripted by the test resolve. */
export class FakeContentFetcher implements ContentFetcher {
  private readonly articles = new Map<string, FetchedArticle | { error: string }>();

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
}
