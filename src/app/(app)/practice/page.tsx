import Link from "next/link";
import { getCore } from "@/server/core";
import { ReviewCard } from "../review/review-card";

export const dynamic = "force-dynamic";

/** The open Practice session (started from a Topic or a Tag). */
export default async function PracticePage() {
  const session = await getCore().practiceSession();

  if (!session) {
    return (
      <section className="panel review-empty" aria-labelledby="practice-heading">
        <h2 id="practice-heading">Nothing to practice</h2>
        <p className="muted">
          Practice a Topic or a Tag from its page whenever you like, even when nothing is due. Only an Again changes when a
          prompt comes back.
        </p>
        <p>
          <Link href="/topics">Browse your Topics</Link>
        </p>
      </section>
    );
  }

  return <ReviewCard key={session.current.id} session={session} />;
}
