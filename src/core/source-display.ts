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

/** Longest name taken from a Note's text before it is shortened at a word. */
const MAX_NAME_CHARS = 60;

/**
 * The name to show for a Source: its title; else its reference (file name or URL); else, for
 * a Note, its first heading or first line; else "Untitled <kind>". The one fallback everywhere.
 */
export function sourceDisplayName(source: {
  kind: SourceKind;
  title: string | null;
  reference: string | null;
  text?: string | null;
}): string {
  return (
    source.title ??
    source.reference ??
    (source.kind === "note" ? nameFromText(source.text ?? "") : null) ??
    `Untitled ${sourceKindLabel(source.kind)}`
  );
}

function nameFromText(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#{1,6}\s/.test(l));
  const line = plain(heading ?? lines[0] ?? "");
  if (!line) return null;
  if (line.length <= MAX_NAME_CHARS) return line;
  const cut = line.slice(0, MAX_NAME_CHARS + 1);
  const atWord = cut.slice(0, cut.lastIndexOf(" "));
  return `${(atWord || line.slice(0, MAX_NAME_CHARS)).replace(/[\s,;:]+$/, "")}…`;
}

/** A markdown line as plain text: no heading, list or quote markers, emphasis or link syntax. */
function plain(line: string): string {
  return line
    .replace(/^(#{1,6}|[-*+]|\d+[.)]|>)\s+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
}
