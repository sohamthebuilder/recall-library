import type { ReviewRating } from "@/core";
import { getCore } from "@/server/core";

const RATING_LABEL: Record<ReviewRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** A Topic's Review history, newest first: how well the learner is remembering it. */
export async function ReviewHistory({ topicId }: { topicId: string }) {
  const reviews = await getCore().topicReviews(topicId);
  return (
    <section aria-labelledby="topic-review-history">
      <h2 id="topic-review-history" className="aside-heading">
        Review history
      </h2>
      {reviews.length === 0 ? (
        <p className="muted">No Reviews yet.</p>
      ) : (
        <ul className="review-history">
          {reviews.map((r) => (
            <li key={r.id}>
              <div className="row-between">
                <strong>
                  {RATING_LABEL[r.rating]}
                  {r.kind === "practice" ? <span className="badge">Practice</span> : null}
                  {r.overruled ? <span className="muted"> (overruled {RATING_LABEL[r.aiRating]})</span> : null}
                </strong>
                <time className="source-meta" dateTime={r.reviewedAt.toISOString()}>
                  {dateFormat.format(r.reviewedAt)}
                </time>
              </div>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {r.question}
              </p>
              {r.pointsMissed.length > 0 ? (
                <p className="source-meta" style={{ margin: "4px 0 0" }}>
                  Missed: {r.pointsMissed.join("; ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
