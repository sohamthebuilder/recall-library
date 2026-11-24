import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/core";
import { getCore } from "@/server/core";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The end of a Review or Practice session: what was done, what comes back soon, what to work on. */
export default async function ReviewSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let summary;
  try {
    summary = await getCore().reviewSummary(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { ratings } = summary;
  const practice = summary.kind === "practice";

  return (
    <section className="panel review-summary" aria-labelledby="summary-heading">
      <h1 id="summary-heading" className="page-title">
        {practice ? "Practice done" : "Review done"}
      </h1>
      <p className="summary-lead">
        You reviewed {plural(summary.reviewed, "Recall Prompt", "Recall Prompts")}
        {summary.skipped > 0 ? ` and skipped ${summary.skipped} (still due)` : ""}.
      </p>
      <ul className="summary-grades" aria-label="Grades">
        <li>
          <strong>{ratings.again}</strong> Again
        </li>
        <li>
          <strong>{ratings.hard}</strong> Hard
        </li>
        <li>
          <strong>{ratings.good}</strong> Good
        </li>
        <li>
          <strong>{ratings.easy}</strong> Easy
        </li>
      </ul>
      {summary.comingBackSoon > 0 ? (
        <p>{plural(summary.comingBackSoon, "prompt comes", "prompts come")} back later today, because you graded them Again.</p>
      ) : null}
      {summary.weakestTopic ? (
        <p>
          Weakest Topic: <Link href={`/topics/${summary.weakestTopic.id}`}>{summary.weakestTopic.name}</Link>. Reread its
          Explainer before the next Review.
        </p>
      ) : summary.reviewed > 0 ? (
        <p className="muted">Every answer was Good or Easy.</p>
      ) : null}
      <div className="button-row">
        <Link href="/" className="button-link primary-link">
          Back to Today
        </Link>
        {practice ? (
          <Link href="/topics" className="button-link">
            Topics
          </Link>
        ) : null}
      </div>
    </section>
  );
}
