import type { Db } from "@/db/types";
import { chunksOfSource, similarChunks } from "./chunks";
import { getExplainer, listExplainerVersions, retryExplainer } from "./explainers";
import { jobHandlers } from "./job-handlers";
import { runJobs, type RunJobsOptions } from "./jobs";
import type { AiAdapter } from "./ports/ai";
import type { Clock } from "./ports/clock";
import type { ContentFetcher } from "./ports/content-fetcher";
import type { FileStore } from "./ports/file-store";
import { addSource, getSource, library, retrySource } from "./sources";
import {
  approveTopic,
  deleteTopic,
  getTopic,
  listTopics,
  mergeTopic,
  rejectTopic,
  topicProposalsForSource,
} from "./topics";

/** Everything the core needs from the outside world. */
export interface CoreDeps {
  db: Db;
  ai: AiAdapter;
  contentFetcher: ContentFetcher;
  fileStore: FileStore;
  clock: Clock;
}

type Arg<F extends (deps: CoreDeps, input: never) => unknown> = Parameters<F>[1];

/**
 * The application core. Every learner-visible behaviour is an operation here, named
 * in the glossary's vocabulary. The UI calls these and does nothing else.
 */
export function createCore(deps: CoreDeps) {
  return {
    // Sources
    addSource: (input: Arg<typeof addSource>) => addSource(deps, input),
    library: () => library(deps),
    source: (sourceId: string) => getSource(deps, sourceId),
    retrySource: (sourceId: string) => retrySource(deps, sourceId),
    sourceChunks: (sourceId: string) => chunksOfSource(deps, sourceId),
    similarChunks: (input: Arg<typeof similarChunks>) => similarChunks(deps, input),

    // Topics
    topicProposals: (sourceId: string) => topicProposalsForSource(deps, sourceId),
    approveTopic: (input: Arg<typeof approveTopic>) => approveTopic(deps, input),
    mergeTopic: (input: Arg<typeof mergeTopic>) => mergeTopic(deps, input),
    rejectTopic: (proposalId: string) => rejectTopic(deps, proposalId),
    topics: () => listTopics(deps),
    topic: (topicId: string) => getTopic(deps, topicId),
    deleteTopic: (topicId: string) => deleteTopic(deps, topicId),

    // Explainers
    explainer: (topicId: string) => getExplainer(deps, topicId),
    explainerVersions: (topicId: string) => listExplainerVersions(deps, topicId),
    retryExplainer: (topicId: string) => retryExplainer(deps, topicId),

    /** Drain the background job queue. See jobs.ts. */
    runJobs: (options?: RunJobsOptions) => runJobs(deps, jobHandlers, options),
  };
}

export type Core = ReturnType<typeof createCore>;
