import type { Explainer } from "@/core";
import { retryExplainer } from "../../actions";
import { RefreshWhileProcessing } from "../../source-status";
import { AnimationPlayer } from "./animation-player";
import { ExplainerDiagramView } from "./explainer-diagram";
import { FormSwitch } from "./form-switch";
import { KeyPoints } from "./key-points";

/** The Topic's Explainer, drawn as an infographic or a step-by-step animation, or why there is none (yet). */
export function ExplainerPanel({ topicId, explainer }: { topicId: string; explainer: Explainer | null }) {
  if (!explainer) {
    return (
      <section className="panel explainer" aria-label="Explainer">
        <p className="muted">No Explainer yet: this Topic is waiting for a Source.</p>
      </section>
    );
  }

  if (!explainer.current) {
    return (
      <section className="panel explainer" aria-label="Explainer">
        <RefreshWhileProcessing active={explainer.status === "generating"} />
        {explainer.status === "failed" ? (
          <>
            <p className="error">{explainer.failureReason}</p>
            <form action={retryExplainer.bind(null, topicId)}>
              <button type="submit" className="primary">
                Try again
              </button>
            </form>
          </>
        ) : (
          <p className="muted" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Making the Explainer from this Topic&apos;s Sources…
          </p>
        )}
      </section>
    );
  }

  const { content } = explainer.current;
  return (
    <article className="panel explainer" aria-labelledby="explainer-title">
      <div className="explainer-head">
        <h2 id="explainer-title" className="explainer-title">
          {content.title}
        </h2>
        <FormSwitch topicId={topicId} form={content.form} />
      </div>
      {content.analogy ? (
        <aside className="analogy">
          <strong>Think of it like this:</strong> {content.analogy}
        </aside>
      ) : null}
      <div className="explainer-body">
        {content.form === "animation" && content.steps.length > 0 ? (
          <AnimationPlayer key={explainer.current.id} content={content} />
        ) : (
          <ExplainerDiagramView diagram={content.diagram} title={content.title} />
        )}
        <KeyPoints keyPoints={content.keyPoints} passages={explainer.passages} />
      </div>
      <p className="source-meta">Version {explainer.current.number}</p>
    </article>
  );
}
