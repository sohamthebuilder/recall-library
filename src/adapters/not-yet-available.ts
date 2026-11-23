import type { ContentFetcher } from "@/core";

/**
 * Placeholders for real adapters that later tickets build (article/YouTube/PDF fetchers).
 * Adding a Note needs none of them. Replace each one in src/server/core.ts
 * as its ticket lands.
 */
function notYet(what: string): never {
  throw new Error(`${what} is not available yet`);
}

export const contentFetcherNotYetAvailable: ContentFetcher = {
  fetchArticle: () => notYet("The content fetcher"),
  fetchYouTubeTranscript: () => notYet("The content fetcher"),
  extractPdf: () => notYet("The content fetcher"),
};
