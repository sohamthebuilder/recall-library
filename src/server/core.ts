import "server-only";
import { createArticleFetcher } from "@/adapters/article-fetcher";
import { contentFetcherNotYetAvailable } from "@/adapters/not-yet-available";
import { openAiFromEnv } from "@/adapters/openai";
import { vercelBlobFromEnv } from "@/adapters/vercel-blob";
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
    },
    fileStore: vercelBlobFromEnv(),
    clock: systemClock,
  });
  return core;
}
