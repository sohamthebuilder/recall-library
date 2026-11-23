import { generateExplainer } from "./explainers";
import type { JobGiveUpHandlers, JobHandlers } from "./jobs";
import { giveUpProposingChapterTopics, proposeChapterTopics } from "./pdf-sources";
import { updateRecallPrompts } from "./recall-prompts";
import { giveUpProcessingSource, processSource } from "./source-processing";
import { suggestEdits } from "./suggested-edits";

/** Every background job kind and the core function that runs it. */
export const jobHandlers: JobHandlers = {
  process_source: processSource,
  generate_explainer: generateExplainer,
  update_recall_prompts: updateRecallPrompts,
  propose_chapter_topics: proposeChapterTopics,
  suggest_edits: suggestEdits,
};

/** Learner-visible outcome of a job given up after it kept dying mid-run (see MAX_JOB_ATTEMPTS). */
export const jobGiveUpHandlers: JobGiveUpHandlers = {
  process_source: giveUpProcessingSource,
  propose_chapter_topics: giveUpProposingChapterTopics,
};
