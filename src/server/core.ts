import "server-only";
import { createArticleFetcher } from "@/adapters/article-fetcher";
import { contentFetcherNotYetAvailable } from "@/adapters/not-yet-available";
import { openAiFromEnv } from "@/adapters/openai";
import { createPdfExtractor } from "@/adapters/pdf-extractor";
import { vercelBlobFromEnv } from "@/adapters/vercel-blob";
import { createYouTubeTranscriptFetcher } from "@/adapters/youtube-transcript";
import { createCore, systemClock, type Core } from "@/core";
import { getDb } from "@/db/client";

let core: Core | undefined;

/** Composition root: the core wired to the real database and adapters. */
export function getCore(): Core {
  core ??= createCore({
    db: getDb(),
    ai: openAiFromEnv(),
    contentFetcher: {
      ...contentFetcherNotYetAvailable,
      ...createArticleFetcher(),
      ...createYouTubeTranscriptFetcher(),
      ...createPdfExtractor(),
    },
    fileStore: vercelBlobFromEnv(),
    clock: systemClock,
  });
  return core;
}
