import type { SourceKind } from "@/core";

/** How each Source kind is named in the UI. */
export const sourceKindLabel: Record<SourceKind, string> = {
  url: "Web page",
  youtube: "YouTube video",
  pdf: "PDF",
  markdown: "Markdown file",
  note: "Note",
};

/** What to show for a Source with no title (yet). */
export function untitled(kind: SourceKind): string {
  return `Untitled ${sourceKindLabel[kind]}`;
}
