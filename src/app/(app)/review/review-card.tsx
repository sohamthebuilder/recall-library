"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Review, ReviewRating, ReviewSession } from "@/core";
import { recallPromptKindLabel } from "@/core/recall-prompt-kinds";
import { RecallPromptForm } from "../topics/[id]/recall-prompt-form";
import { SpokenAnswer } from "./spoken-answer";
import {
  deletePromptInReview,
  editPromptInReview,
  overruleGrade,
  pausePromptInReview,
  type ReviewState,
  skipInReview,
  submitAnswer,
  undoLastGrade,
} from "./actions";

const RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];
const RATING_LABEL: Record<ReviewRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const initial: ReviewState = { error: null, review: null };

/**
 * One prompt of a Review session: type an answer (or speak it, then correct the transcript), or skip
 * it; see the AI's grade (covered, missed, the relevant part of the Explainer), overrule it, move on.
 * The previous grade can only be undone (from a short message), never changed from here.
 * Keyboard: Ctrl/⌘+Enter submits; once graded, 1–4 overrule (Again/Hard/Good/Easy) and Enter goes on.
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
  const summaryHref = `/review/summary/${session.id}`;
  const [skipError, setSkipError] = useState<string | null>(null);

  const next = useCallback(() => {
    startMoving(() => (isLast ? router.push(summaryHref) : router.refresh()));
  }, [isLast, router, summaryHref]);

  const skip = () =>
    startMoving(async () => {
      const result = await skipInReview(session.id, prompt.id);
      setSkipError(result.error);
      if (result.error) return;
      if (result.finished) router.push(summaryHref);
      else router.refresh();
    });

  const total = session.done + session.skipped + session.remaining;
  const position = session.done + session.skipped + 1;

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
        {!review && session.lastReview ? <UndoLastGrade review={session.lastReview} /> : null}
        <div className="review-progress">
          <div className="row-between">
            <span className="muted">
              {session.kind === "practice" ? "Practice · " : null}
              {position} of {total} · {prompt.topicName}
            </span>
            <span className="badge">{recallPromptKindLabel(prompt.kind)}</span>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="Progress through this session"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={position - 1}
          >
            <span style={{ width: `${((position - 1) / total) * 100}%` }} />
          </div>
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
            <SpokenAnswer
              promptId={prompt.id}
              onTranscript={(text) => setAnswer((typed) => (typed.trim() ? `${typed.trimEnd()} ${text}` : text))}
            />
          )}
          {review ? null : (
            <div className="button-row">
              <button type="submit" className="primary" disabled={submitting || moving}>
                {submitting ? "Grading…" : "Submit answer"}
              </button>
              <span className="hint">Ctrl/⌘ + Enter</span>
              <button type="button" className="skip-button" onClick={skip} disabled={submitting || moving}>
                Skip
              </button>
            </div>
          )}
          {skipError ? (
            <p className="error" role="alert">
              {skipError}
            </p>
          ) : null}
          {state.error ? (
            <p className="error" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>

        {review ? <GradeResult review={review} onOverruled={setGraded} onNext={next} moving={moving} isLast={isLast} /> : null}
      </section>

      <aside className="stack">
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
      {review.explainerKeyPoints.length > 0 && review.pointsMissed.length > 0 ? (
        <div className="review-explainer">
          <h3 className="subheading">From the Explainer, for what you missed</h3>
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

/** The AI's grade, and how to overrule it: the final grade decides when the prompt comes back. */
function GradeButtons({ review, onOverruled }: { review: Review; onOverruled: (r: Review) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const others = RATINGS.map((r, i) => ({ r, key: i + 1 })).filter(({ r }) => r !== review.rating);
  return (
    <div className="review-grade">
      <p>
        {review.overruled ? (
          <>
            Your grade: <strong>{RATING_LABEL[review.rating]}</strong>{" "}
            <span className="muted">(the AI said {RATING_LABEL[review.aiRating]})</span>
          </>
        ) : (
          <>
            AI graded: <strong>{RATING_LABEL[review.rating]}</strong>
          </>
        )}
      </p>
      <div className="button-row overrule" role="group" aria-label="Overrule the grade">
        <span className="muted">{review.overruled ? "Change it:" : "Disagree?"}</span>
        {others.map(({ r, key }) => (
          <button
            key={r}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const s = await overruleGrade(review.id, r);
                setError(s.error);
                if (s.review) onOverruled(s.review);
              })
            }
          >
            {RATING_LABEL[r]} <span className="hint">{key}</span>
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

/** After moving on: the previous grade, which can be undone (the prompt is then asked again). */
function UndoLastGrade({ review }: { review: Review }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="undo-notice" role="status">
      <span>
        Last prompt graded <strong>{RATING_LABEL[review.rating]}</strong>.
      </span>
      <button
        type="button"
        className="link-button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const s = await undoLastGrade(review.id);
            setError(s.error);
            if (!s.error) router.refresh();
          })
        }
      >
        Undo
      </button>
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
