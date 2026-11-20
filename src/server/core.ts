import "server-only";
import {
  aiNotYetAvailable,
  contentFetcherNotYetAvailable,
  fileStoreNotYetAvailable,
} from "@/adapters/not-yet-available";
import { createCore, systemClock, type Core } from "@/core";
import { getDb } from "@/db/client";

let core: Core | undefined;

/** Composition root: the core wired to the real database and adapters. */
export function getCore(): Core {
  core ??= createCore({
    db: getDb(),
    ai: aiNotYetAvailable,
    contentFetcher: contentFetcherNotYetAvailable,
    fileStore: fileStoreNotYetAvailable,
    clock: systemClock,
  });
  return core;
}
