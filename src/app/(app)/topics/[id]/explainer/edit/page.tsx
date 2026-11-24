import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/core";
import { getCore } from "@/server/core";
import { ExplainerTextForm } from "./explainer-text-form";

export const dynamic = "force-dynamic";

export default async function EditExplainerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const core = getCore();
  let topic, explainer;
  try {
    [topic, explainer] = await Promise.all([core.topic(id), core.explainer(id)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (!explainer?.current) notFound();

  return (
    <>
      <header className="topic-header">
        <p className="muted" style={{ margin: "0 0 4px" }}>
          <Link href={`/topics/${topic.id}`}>← {topic.name}</Link>
        </p>
        <h2>Edit the Explainer&apos;s text</h2>
        <p className="muted">
          Put it in your own words. Saving makes version {explainer.current.number + 1}; your Recall Prompts are then
          checked against it.
        </p>
      </header>
      <section className="panel explainer-edit-panel">
        <ExplainerTextForm topicId={topic.id} versionId={explainer.current.id} content={explainer.current.content} />
      </section>
    </>
  );
}
