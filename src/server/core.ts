import "server-only";
import { contentFetcherNotYetAvailable, fileStoreNotYetAvailable } from "@/adapters/not-yet-available";
import { openAiFromEnv } from "@/adapters/openai";
import { createCore, systemClock, type Core } from "@/core";
import { getDb } from "@/db/client";

let core: Core | undefined;

/** Composition root: the core wired to the real database and adapters. */
export function getCore(): Core {
  core ??= createCore({
    db: getDb(),
    ai: openAiFromEnv(),
    contentFetcher: contentFetcherNotYetAvailable,
    fileStore: fileStoreNotYetAvailable,
    clock: systemClock,
  });
  return core;
}
