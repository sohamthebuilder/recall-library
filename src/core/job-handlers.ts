import { generateExplainer } from "./explainers";
import type { JobHandlers } from "./jobs";
import { proposeChapterTopics } from "./pdf-sources";
import { processSource } from "./source-processing";

/** Every background job kind and the core function that runs it. */
export const jobHandlers: JobHandlers = {
  process_source: processSource,
  generate_explainer: generateExplainer,
  propose_chapter_topics: proposeChapterTopics,
};
