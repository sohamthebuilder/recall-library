import Link from "next/link";
import { getCore } from "@/server/core";
import { learnerTimeZone } from "@/server/time-zone";
import { ReviewCard } from "./review-card";

export const dynamic = "force-dynamic";

/** The daily Review: resumes the open session, or starts one over today's due queue. */
export default async function ReviewPage() {
  const session = await getCore().startReview({ timeZone: learnerTimeZone() });

  if (!session) {
    return (
      <section className="panel review-empty" aria-labelledby="review-heading">
        <h2 id="review-heading">Nothing due</h2>
        <p className="muted">You have reviewed everything due today. Come back tomorrow.</p>
        <p>
          <Link href="/topics">Browse your Topics</Link>
        </p>
      </section>
    );
  }

  return <ReviewCard key={session.current.id} session={session} />;
}
