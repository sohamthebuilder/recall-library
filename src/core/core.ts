import type { Db } from "@/db/types";
import type { AiAdapter } from "./ports/ai";
import type { Clock } from "./ports/clock";
import type { ContentFetcher } from "./ports/content-fetcher";
import type { FileStore } from "./ports/file-store";
import { addSource, library } from "./sources";

/** Everything the core needs from the outside world. */
export interface CoreDeps {
  db: Db;
  ai: AiAdapter;
  contentFetcher: ContentFetcher;
  fileStore: FileStore;
  clock: Clock;
}

/**
 * The application core. Every learner-visible behaviour is an operation here, named
 * in the glossary's vocabulary. The UI calls these and does nothing else.
 */
export function createCore(deps: CoreDeps) {
  return {
    addSource: (input: Parameters<typeof addSource>[1]) => addSource(deps, input),
    library: () => library(deps),
  };
}

export type Core = ReturnType<typeof createCore>;
