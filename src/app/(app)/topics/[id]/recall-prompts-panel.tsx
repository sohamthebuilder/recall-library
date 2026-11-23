import type { Explainer, RecallPrompt, RecallPromptOrigin } from "@/core";
import { recallPromptKindLabel } from "@/core/recall-prompt-kinds";
import {
  addRecallPrompt,
  deleteRecallPrompt,
  generateRecallPrompts,
  resumeRecallPrompt,
  suspendRecallPrompt,
} from "../../actions";
import { EditRecallPrompt } from "./edit-recall-prompt";
import { RecallPromptForm } from "./recall-prompt-form";

const originLabel: Record<RecallPromptOrigin, string> = {
  generated: "Generated",
  learner_edited: "Edited by you",
  learner_written: "Written by you",
};

/** A Topic's Recall Prompts, beside its Explainer: list, edit, pause/resume, delete, write your own. */
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
  return (
    <section aria-labelledby="topic-recall-prompts">
      <h2 id="topic-recall-prompts" className="aside-heading">
        Recall Prompts
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
        <ul className="recall-prompt-list">
          {shown.map((prompt) => (
            <li key={prompt.id} className={`panel recall-prompt${prompt.state === "suspended" ? " is-paused" : ""}`}>
              <div className="recall-prompt-meta">
                <span className="badge">{recallPromptKindLabel(prompt.kind)}</span>
                <span className="source-meta">
                  {originLabel[prompt.origin]}
                  {prompt.state === "suspended" ? " · Paused" : ""}
                </span>
              </div>
              <p className="recall-prompt-question">{prompt.question}</p>
              <details>
                <summary>Expected key points</summary>
                <ul className="plain-list">
                  {prompt.expectedPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </details>
              <div className="button-row">
                <EditRecallPrompt topicId={topicId} prompt={prompt} />
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
                  <button type="submit" className="danger" aria-label={`Delete Recall Prompt: ${prompt.question}`}>
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <details className="recall-prompt-add">
        <summary>Write your own Recall Prompt</summary>
        <RecallPromptForm action={addRecallPrompt.bind(null, topicId)} submitLabel="Add" />
      </details>
    </section>
  );
}
