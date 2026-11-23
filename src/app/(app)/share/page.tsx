import { findLink } from "@/core";
import { QuickAddForm } from "../quick-add-form";

export const dynamic = "force-dynamic";

type ShareParams = Record<"title" | "text" | "url", string | string[] | undefined>;

/**
 * The Web Share Target (see app/manifest.ts): the Share menu opens this with the shared
 * title, text and url. Apps put the link in either `url` or `text`, so all of it is offered;
 * the core picks out the link. Adding takes one tap, so a crafted link to this page can't
 * add a Source by itself.
 */
export default async function SharePage({ searchParams }: { searchParams: Promise<Partial<ShareParams>> }) {
  const params = await searchParams;
  const shared = [params.url, params.text, params.title].flat().filter(Boolean).join("\n");

  return (
    <section className="panel share-panel" aria-labelledby="share-heading">
      <h2 id="share-heading">Add to your Library</h2>
      <QuickAddForm sharedLink={findLink(shared) ?? shared} />
    </section>
  );
}
