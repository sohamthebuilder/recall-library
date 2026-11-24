"use client";

import { useEffect, useState } from "react";
import type { ExplainerContent } from "@/core";
import { ExplainerDiagramView } from "./explainer-diagram";

/**
 * An animated Explainer: the learner steps through it at their own pace. Each step
 * highlights part of the diagram with a caption. Back/Next buttons (large enough to tap
 * on a phone), and the left/right arrow keys on a laptop.
 */
export function AnimationPlayer({ content }: { content: ExplainerContent }) {
  const total = content.steps.length;
  const [index, setIndex] = useState(0);
  const current = Math.min(index, total - 1);
  const step = content.steps[current];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  if (!step) return null;
  return (
    <section className="animation" aria-label="Animation" aria-roledescription="step-by-step animation">
      <ExplainerDiagramView diagram={content.diagram} title={content.title} highlight={step.highlight} />
      <p className="animation-caption" aria-live="polite">
        <span className="animation-count">
          Step {current + 1} of {total}
        </span>
        {step.caption}
      </p>
      <div className="animation-controls">
        <button type="button" onClick={() => setIndex(current - 1)} disabled={current === 0} aria-keyshortcuts="ArrowLeft">
          ← Back
        </button>
        <ol className="animation-dots" aria-label="Steps">
          {content.steps.map((_, i) => (
            <li key={i}>
              <button
                type="button"
                className={i === current ? "active" : undefined}
                aria-current={i === current ? "step" : undefined}
                aria-label={`Step ${i + 1}`}
                onClick={() => setIndex(i)}
              />
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => setIndex(current + 1)}
          disabled={current === total - 1}
          aria-keyshortcuts="ArrowRight"
        >
          Next →
        </button>
      </div>
      <p className="animation-hint muted">Tip: use the ← and → keys.</p>
    </section>
  );
}
