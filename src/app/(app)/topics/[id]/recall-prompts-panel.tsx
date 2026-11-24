import type { Explainer, RecallPrompt, RecallPromptOrigin } from "@/core";
import { recallPromptKindLabel } from "@/core/recall-prompt-kinds";
import {
  addRecallPrompt,
  deleteRecallPrompt,
  generateRecallPrompts,
  resumeRecallPrompt,
  suspendRecallPrompt,
} from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { MoreMenu } from "../../more-menu";
import { EditRecallPrompt } from "./edit-recall-prompt";
import { RecallPromptForm } from "./recall-prompt-form";

const originLabel: Record<RecallPromptOrigin, string> = {
  generated: "Generated",
  learner_edited: "Edited by you",
  learner_written: "Written by you",
};

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "due now", "due 3 Mar", or "paused". */
function nextDue(prompt: RecallPrompt, now: Date): string {
  if (prompt.state === "suspended") return "Paused";
  return prompt.due <= now ? "Due now" : `Due ${dayFormat.format(prompt.due)}`;
}

/**
 * A Topic's Recall Prompts as a compact list (kind · question · next due). Each expands to
 * its expected key points and Edit; Pause and Delete sit in its "⋯" menu.
 */
export function RecallPromptsPanel({
  topicId,
  explainer,
  prompts,
}: {
  topicId: string;
  explainer: Explainer | null;
  prompts: RecallPrompt[];
}) {
  const shown = prompts.filter((p) => p.state !== "retired");
  const now = new Date();
  return (
    <section aria-labelledby="topic-recall-prompts">
      <h2 id="topic-recall-prompts" className="aside-heading">
        Recall Prompts <span className="aside-count">{shown.length}</span>
      </h2>
      {shown.length === 0 ? (
        explainer?.status === "ready" ? (
          <div className="stack">
            <p className="muted">No Recall Prompts yet. They are made from the Explainer.</p>
            <form action={generateRecallPrompts.bind(null, topicId)}>
              <button type="submit">Make Recall Prompts</button>
            </form>
          </div>
        ) : (
          <p className="muted">Recall Prompts are made once the Explainer is ready.</p>
        )
      ) : (
        <ul className="prompt-rows">
          {shown.map((prompt) => (
            <li key={prompt.id} className={prompt.state === "suspended" ? "prompt-row is-paused" : "prompt-row"}>
              <details>
                <summary>
                  <span className="prompt-row-meta">
                    {recallPromptKindLabel(prompt.kind)} · {nextDue(prompt, now)}
                  </span>
                  <span className="prompt-row-question">{prompt.question}</span>
                </summary>
                <div className="prompt-row-body">
                  <h3 className="compare-heading">Expected key points</h3>
                  <ul className="plain-list">
                    {prompt.expectedPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                  <p className="source-meta">{originLabel[prompt.origin]}</p>
                  <div className="button-row">
                    <EditRecallPrompt topicId={topicId} prompt={prompt} />
                    <MoreMenu label={`More actions for this Recall Prompt`}>
                      {prompt.state === "suspended" ? (
                        <form action={resumeRecallPrompt.bind(null, topicId, prompt.id)}>
                          <button type="submit">Resume</button>
                        </form>
                      ) : (
                        <form action={suspendRecallPrompt.bind(null, topicId, prompt.id)}>
                          <button type="submit">Pause</button>
                        </form>
                      )}
                      <form action={deleteRecallPrompt.bind(null, topicId, prompt.id)}>
                        <ConfirmButton
                          label="Delete"
                          ariaLabel={`Delete Recall Prompt: ${prompt.question}`}
                          confirmMessage="Delete this Recall Prompt? Its Review history stays with the Topic."
                        />
                      </form>
                    </MoreMenu>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <details className="aside-disclosure">
        <summary>Write your own Recall Prompt</summary>
        <RecallPromptForm action={addRecallPrompt.bind(null, topicId)} submitLabel="Add" />
      </details>
    </section>
  );
}
