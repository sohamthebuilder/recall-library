import { generateExplainer } from "./explainers";
import type { JobHandlers } from "./jobs";
import { proposeChapterTopics } from "./pdf-sources";
import { updateRecallPrompts } from "./recall-prompts";
import { processSource } from "./source-processing";
import { suggestEdits } from "./suggested-edits";

/** Every background job kind and the core function that runs it. */
export const jobHandlers: JobHandlers = {
  process_source: processSource,
  generate_explainer: generateExplainer,
  update_recall_prompts: updateRecallPrompts,
  propose_chapter_topics: proposeChapterTopics,
  suggest_edits: suggestEdits,
};
