import type { Db } from "@/db/types";
import { chunksOfSource, similarChunks } from "./chunks";
import {
  compareExplainerWithSources,
  type EditExplainerTextInput,
  editExplainerText,
  type ExplainerVersionRef,
  getExplainerVersion,
  restoreExplainerVersion,
} from "./explainer-editing";
import {
  countExplainersCitingSource,
  getExplainer,
  listExplainerVersions,
  retryExplainer,
  type SwitchExplainerFormInput,
  switchExplainerForm,
} from "./explainers";
import { jobHandlers } from "./job-handlers";
import { runJobs, type RunJobsOptions } from "./jobs";
import type { AiAdapter } from "./ports/ai";
import type { Clock } from "./ports/clock";
import type { ContentFetcher } from "./ports/content-fetcher";
import type { FileStore } from "./ports/file-store";
import { chaptersOfSource, selectChapters } from "./pdf-sources";
import { addLink } from "./quick-add";
import {
  addRecallPrompt,
  deleteRecallPrompt,
  editRecallPrompt,
  generateRecallPrompts,
  listRecallPrompts,
  resumeRecallPrompt,
  suspendRecallPrompt,
} from "./recall-prompts";
import {
  type DueOptions,
  dueRecallPrompts,
  overruleGrade,
  reviewSession,
  startReview,
  submitReview,
  topicReviews,
} from "./reviews";
import { type PracticeScope, practiceSession, startPractice } from "./practice";
import { addSource, deleteSource, getSource, library, retrySource } from "./sources";
import { type FindTopicsInput, findTopics, listTags, tagTopic, untagTopic } from "./tags";
import { importTopics, linkSourceByHand } from "./topic-import";
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
    /** Quick add / Share menu: a pasted or shared link goes to the YouTube or blog URL flow. */
    addLink: (input: Arg<typeof addLink>) => addLink(deps, input),
    library: () => library(deps),
    source: (sourceId: string) => getSource(deps, sourceId),
    retrySource: (sourceId: string) => retrySource(deps, sourceId),
    /** Delete a Source; Explainers citing it are left unchanged ("Source removed"). */
    deleteSource: (sourceId: string) => deleteSource(deps, sourceId),
    /** How many Explainers cite the Source (current versions): the warning before deleting it. */
    explainersCitingSource: (sourceId: string) => countExplainersCitingSource(deps, sourceId),
    sourceChunks: (sourceId: string) => chunksOfSource(deps, sourceId),
    similarChunks: (input: Arg<typeof similarChunks>) => similarChunks(deps, input),
    /** A PDF's chapters (outline or page ranges) and which have had Topics proposed. */
    sourceChapters: (sourceId: string) => chaptersOfSource(deps, sourceId),
    selectChapters: (input: Arg<typeof selectChapters>) => selectChapters(deps, input),

    // Topics
    topicProposals: (sourceId: string) => topicProposalsForSource(deps, sourceId),
    approveTopic: (input: Arg<typeof approveTopic>) => approveTopic(deps, input),
    mergeTopic: (input: Arg<typeof mergeTopic>) => mergeTopic(deps, input),
    rejectTopic: (proposalId: string) => rejectTopic(deps, proposalId),
    topics: () => listTopics(deps),
    topic: (topicId: string) => getTopic(deps, topicId),
    deleteTopic: (topicId: string) => deleteTopic(deps, topicId),
    importTopics: (list: string) => importTopics(deps, list),
    linkSourceToTopic: (input: Arg<typeof linkSourceByHand>) => linkSourceByHand(deps, input),

    // Tags
    tagTopic: (input: Arg<typeof tagTopic>) => tagTopic(deps, input),
    untagTopic: (input: Arg<typeof untagTopic>) => untagTopic(deps, input),
    tags: () => listTags(deps),
    /** Topics by name search and/or Tags (all of them). Practice by Tag uses `{ tagIds: [id] }`. */
    findTopics: (input?: FindTopicsInput) => findTopics(deps, input),

    // Explainers
    explainer: (topicId: string) => getExplainer(deps, topicId),
    explainerVersions: (topicId: string) => listExplainerVersions(deps, topicId),
    retryExplainer: (topicId: string) => retryExplainer(deps, topicId),
    switchExplainerForm: (input: SwitchExplainerFormInput) => switchExplainerForm(deps, input),
    /** Put the Explainer in the learner's own words: title, key points, analogy, diagram labels. */
    editExplainerText: (input: EditExplainerTextInput) => editExplainerText(deps, input),
    /** One version (current or earlier) with the passages it cites. */
    explainerVersion: (ref: ExplainerVersionRef) => getExplainerVersion(deps, ref),
    /** The current key points next to the Source passages they cite, and what the AI first wrote. */
    explainerComparison: (topicId: string) => compareExplainerWithSources(deps, topicId),
    /** Make an earlier version current again, as a new version (cause `restore`). */
    restoreExplainerVersion: (ref: ExplainerVersionRef) => restoreExplainerVersion(deps, ref),

    // Recall Prompts
    recallPrompts: (topicId: string) => listRecallPrompts(deps, topicId),
    generateRecallPrompts: (topicId: string) => generateRecallPrompts(deps, topicId),
    editRecallPrompt: (input: Arg<typeof editRecallPrompt>) => editRecallPrompt(deps, input),
    addRecallPrompt: (input: Arg<typeof addRecallPrompt>) => addRecallPrompt(deps, input),
    suspendRecallPrompt: (promptId: string) => suspendRecallPrompt(deps, promptId),
    resumeRecallPrompt: (promptId: string) => resumeRecallPrompt(deps, promptId),
    deleteRecallPrompt: (promptId: string) => deleteRecallPrompt(deps, promptId),

    // Reviews (#6)
    /** Every active prompt due today or earlier, interleaved across Topics, with an estimated duration. */
    dueRecallPrompts: (options?: DueOptions) => dueRecallPrompts(deps, options),
    /** Resume the open Review session, or start one over the due queue (null when nothing is due). */
    startReview: (options?: DueOptions) => startReview(deps, options),
    /** The open Review session, or null. */
    reviewSession: () => reviewSession(deps),
    /** Grade a typed answer and reschedule the prompt with the rating. */
    submitReview: (input: Arg<typeof submitReview>) => submitReview(deps, input),
    /** Replace a Review's rating; the final rating reschedules the prompt. */
    overruleGrade: (input: Arg<typeof overruleGrade>) => overruleGrade(deps, input),
    /** A Topic's Review history, newest first (deleted prompts' Reviews included). */
    topicReviews: (topicId: string) => topicReviews(deps, topicId),

    // Practice (#8)
    /** Start Practice over a Topic's or a Tag's active prompts, due or not (null if there are none). */
    startPractice: (scope: PracticeScope) => startPractice(deps, scope),
    /** The open Practice session, or null. */
    practiceSession: () => practiceSession(deps),

    /** Drain the background job queue. See jobs.ts. */
    runJobs: (options?: RunJobsOptions) => runJobs(deps, jobHandlers, options),
  };
}

export type Core = ReturnType<typeof createCore>;
