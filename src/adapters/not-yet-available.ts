import type { AiAdapter, ContentFetcher, FileStore } from "@/core";

/**
 * Placeholders for real adapters that later tickets build (OpenAI, article/YouTube/PDF
 * fetchers, Vercel Blob). Adding a Note needs none of them. Replace each one in
 * src/server/core.ts as its ticket lands.
 */
function notYet(what: string): never {
  throw new Error(`${what} is not available yet`);
}

export const aiNotYetAvailable: AiAdapter = {
  embed: () => notYet("The AI adapter"),
};

export const contentFetcherNotYetAvailable: ContentFetcher = {
  fetchArticle: () => notYet("The content fetcher"),
};

export const fileStoreNotYetAvailable: FileStore = {
  put: () => notYet("The file store"),
  get: () => notYet("The file store"),
  delete: () => notYet("The file store"),
};
