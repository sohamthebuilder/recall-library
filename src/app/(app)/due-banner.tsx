import Link from "next/link";
import { getCore } from "@/server/core";
import { learnerTimeZone } from "@/server/time-zone";

/** Home screen: how many Recall Prompts are due today and roughly how long they'll take. */
export async function DueBanner() {
  const { prompts, estimatedMinutes } = await getCore().dueRecallPrompts({ timeZone: learnerTimeZone() });
  return (
    <section className="panel due-banner row-between" aria-labelledby="due-heading">
      <div>
        <h2 id="due-heading">Today&rsquo;s Review</h2>
        {prompts.length === 0 ? (
          <p className="muted">Nothing due. You are up to date.</p>
        ) : (
          <p>
            {prompts.length} Recall {prompts.length === 1 ? "Prompt" : "Prompts"} due · about {estimatedMinutes} min
          </p>
        )}
      </div>
      {prompts.length > 0 ? (
        <Link href="/review" className="due-start">
          Start Review
        </Link>
      ) : null}
    </section>
  );
}
