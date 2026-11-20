// Dependency-free so client components can import it without pulling in the core.
type SourceKind = "url" | "youtube" | "pdf" | "markdown" | "note";

const kindLabels: Record<SourceKind, string> = {
  url: "Blog post",
  youtube: "YouTube video",
  pdf: "PDF",
  markdown: ".md file",
  note: "Note",
};

/** How a Source kind is named to the learner, e.g. ".md file". */
export function sourceKindLabel(kind: SourceKind): string {
  return kindLabels[kind];
}

/** The name to show for a Source: its title, else its reference (file name or URL). */
export function sourceDisplayName(source: { kind: SourceKind; title: string | null; reference: string | null }): string {
  return source.title ?? source.reference ?? `Untitled ${sourceKindLabel(source.kind)}`;
}
