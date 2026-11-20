import { generateExplainer } from "./explainers";
import type { JobHandlers } from "./jobs";
import { updateRecallPrompts } from "./recall-prompts";
import { processSource } from "./source-processing";

/** Every background job kind and the core function that runs it. */
export const jobHandlers: JobHandlers = {
  process_source: processSource,
  generate_explainer: generateExplainer,
  update_recall_prompts: updateRecallPrompts,
};
