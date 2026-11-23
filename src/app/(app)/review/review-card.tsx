"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Review, ReviewRating, ReviewSession } from "@/core";
import { recallPromptKindLabel } from "@/core/recall-prompt-kinds";
import { RecallPromptForm } from "../topics/[id]/recall-prompt-form";
import {
  deletePromptInReview,
  editPromptInReview,
  overruleGrade,
  pausePromptInReview,
  type ReviewState,
  submitAnswer,
} from "./actions";

const RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];
const RATING_LABEL: Record<ReviewRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const initial: ReviewState = { error: null, review: null };

/**
 * One prompt of a Review session: type an answer, see the grade (covered, missed, the relevant
 * part of the Explainer), overrule it, move on. Keyboard: Ctrl/⌘+Enter submits; once graded,
 * 1–4 overrule (Again/Hard/Good/Easy) and Enter goes to the next prompt.
 */
export function ReviewCard({ session }: { session: ReviewSession }) {
  const router = useRouter();
  const prompt = session.current;
  const [state, submit, submitting] = useActionState(submitAnswer.bind(null, session.id, prompt.id), initial);
  // Controlled, so a failed grading (form reset) keeps what the learner typed.
  const [answer, setAnswer] = useState("");
  const [graded, setGraded] = useState<Review | null>(null);
  const review = graded ?? state.review;
  const [moving, startMoving] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isLast = session.remaining === 1;

  const next = useCallback(() => {
    startMoving(() => (isLast ? router.push("/") : router.refresh()));
  }, [isLast, router]);

  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("textarea, input, select")) return;
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      if (index >= 0) {
        e.preventDefault();
        void overruleGrade(review.id, RATINGS[index]!).then((s) => s.review && setGraded(s.review));
      } else if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [review, next]);

  return (
    <div className="review-layout">
      <section className="panel review-card" aria-labelledby="review-question">
        <div className="row-between review-progress">
          <span className="muted">
            {session.done + 1} of {session.done + session.remaining} · {prompt.topicName}
          </span>
          <span className="badge">{recallPromptKindLabel(prompt.kind)}</span>
        </div>
        <h2 id="review-question" className="review-question">
          {prompt.question}
        </h2>

        <form ref={formRef} action={submit} className="stack">
          <label htmlFor="review-answer" className="visually-hidden">
            Your answer
          </label>
          <textarea
            id="review-answer"
            name="answer"
            rows={7}
            required
            autoFocus
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            readOnly={!!review}
            placeholder="Explain it in your own words…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          {review ? null : (
            <div className="button-row">
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? "Grading…" : "Submit answer"}
              </button>
              <span className="hint">Ctrl/⌘ + Enter</span>
            </div>
          )}
          {state.error ? (
            <p className="error" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>

        {review ? <GradeResult review={review} onOverruled={setGraded} onNext={next} moving={moving} isLast={isLast} /> : null}
      </section>

      <aside className="stack">
        {!review && session.lastReview ? <PreviousReview review={session.lastReview} /> : null}
        <details className="panel review-tools">
          <summary>Fix this prompt</summary>
          <RecallPromptForm action={editPromptInReview.bind(null, prompt.id)} prompt={prompt} submitLabel="Save" onDone={router.refresh} />
          <div className="button-row">
            <form action={pausePromptInReview.bind(null, prompt.id)}>
              <button type="submit">Pause it</button>
            </form>
            <form action={deletePromptInReview.bind(null, prompt.id)}>
              <button type="submit" className="danger">
                Delete it
              </button>
            </form>
          </div>
        </details>
      </aside>
    </div>
  );
}

function GradeResult({
  review,
  onOverruled,
  onNext,
  moving,
  isLast,
}: {
  review: Review;
  onOverruled: (r: Review) => void;
  onNext: () => void;
  moving: boolean;
  isLast: boolean;
}) {
  return (
    <div className="review-result" aria-live="polite">
      <GradeButtons review={review} onOverruled={onOverruled} />
      <div className="review-points">
        <div>
          <h3 className="subheading">Covered</h3>
          {review.pointsCovered.length === 0 ? (
            <p className="muted">None of the expected points.</p>
          ) : (
            <ul className="plain-list points-covered">
              {review.pointsCovered.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="subheading">Missed</h3>
          {review.pointsMissed.length === 0 ? (
            <p className="muted">Nothing missed.</p>
          ) : (
            <ul className="plain-list points-missed">
              {review.pointsMissed.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {review.explainerKeyPoints.length > 0 ? (
        <div className="review-explainer">
          <h3 className="subheading">From the Explainer</h3>
          <ul className="plain-list">
            {review.explainerKeyPoints.map((k) => (
              <li key={k.id}>{k.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="button-row">
        <button type="button" className="primary" onClick={onNext} disabled={moving} autoFocus>
          {isLast ? "Finish" : "Next prompt"}
        </button>
        <span className="hint">Enter</span>
      </div>
    </div>
  );
}

/** The grade, with the learner's buttons to overrule it. */
function GradeButtons({ review, onOverruled }: { review: Review; onOverruled: (r: Review) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="review-grade">
      <p>
        Grade: <strong>{RATING_LABEL[review.rating]}</strong>
        {review.overruled ? <span className="muted"> (yours; the AI said {RATING_LABEL[review.aiRating]})</span> : null}
      </p>
      <div className="button-row" role="group" aria-label="Overrule the grade">
        {RATINGS.map((r, i) => (
          <button
            key={r}
            type="button"
            aria-pressed={review.rating === r}
            className={review.rating === r ? "primary" : undefined}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const s = await overruleGrade(review.id, r);
                setError(s.error);
                if (s.review) onOverruled(s.review);
              })
            }
          >
            {RATING_LABEL[r]} <span className="hint">{i + 1}</span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** After resuming: the last answer of this session, which can still be overruled. */
function PreviousReview({ review: initialReview }: { review: Review }) {
  const [review, setReview] = useState(initialReview);
  return (
    <section className="panel" aria-labelledby="previous-review">
      <h3 id="previous-review" className="subheading">
        Your last answer
      </h3>
      <p className="muted">{review.question}</p>
      <GradeButtons review={review} onOverruled={setReview} />
    </section>
  );
}
