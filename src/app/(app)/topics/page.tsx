import Link from "next/link";
import { getCore } from "@/server/core";

export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const topics = await getCore().topics();

  return (
    <section aria-labelledby="topics">
      <h2 id="topics" style={{ marginTop: 0 }}>
        Topics
      </h2>
      {topics.length === 0 ? (
        <p className="muted">No Topics yet. Add a Source and approve the Topics it proposes.</p>
      ) : (
        <ul className="topic-grid">
          {topics.map((topic) => (
            <li key={topic.id} className="panel">
              <h3>
                <Link href={`/topics/${topic.id}`}>{topic.name}</Link>
              </h3>
              {topic.description ? <p className="muted">{topic.description}</p> : null}
              <div className="source-meta">
                {topic.sourceCount === 0
                  ? "Waiting for a Source"
                  : `${topic.sourceCount} Source${topic.sourceCount === 1 ? "" : "s"}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
