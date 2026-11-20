import { desc } from "drizzle-orm";
import { sources } from "@/db/schema";
import type { CoreDeps } from "./core";
import { ValidationError } from "./errors";

export type SourceKind = "url" | "youtube" | "pdf" | "markdown" | "note";

export interface Source {
  id: string;
  kind: SourceKind;
  title: string | null;
  reference: string | null;
  text: string;
  addedAt: Date;
}

export interface Library {
  /** Newest first. */
  sources: Source[];
}

export type AddSourceInput = { kind: "note"; title?: string | null; text: string };

export async function addSource(deps: CoreDeps, input: AddSourceInput): Promise<Source> {
  const text = input.text.trim();
  if (!text) throw new ValidationError("A Note needs some text.");
  const title = input.title?.trim() || null;

  const [row] = await deps.db
    .insert(sources)
    .values({
      kind: "note",
      title,
      reference: null,
      text,
      addedAt: deps.clock.now(),
    })
    .returning();
  return row!;
}

export async function library(deps: CoreDeps): Promise<Library> {
  const rows = await deps.db.select().from(sources).orderBy(desc(sources.addedAt));
  return { sources: rows };
}
