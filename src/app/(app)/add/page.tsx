import { AddBox } from "./add-box";

export const dynamic = "force-dynamic";

type Kind = "link" | "note" | "markdown" | "pdf";
const kinds: Kind[] = ["link", "note", "markdown", "pdf"];

/** The one place to add a Source: a link (blog post or YouTube), a Note, a .md file or a PDF. */
export default async function AddPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const initial = kinds.includes(kind as Kind) ? (kind as Kind) : "link";
  return (
    <section className="add-page" aria-labelledby="add-heading">
      <h1 id="add-heading" className="page-title">
        Add to your Library
      </h1>
      <AddBox initial={initial} />
    </section>
  );
}
