import { eq, sql } from "drizzle-orm";
import { sources, topics } from "@/db/schema";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { getTopic, linkSourceToTopic, topicEmbeddingText, type TopicSummary } from "./topics";

export interface ImportTopicsResult {
  /** The Topics created, in the order they were listed. Each waits for a Source. */
  created: TopicSummary[];
  /** Listed names skipped because a Topic with that name already exists (or was listed twice). */
  skipped: string[];
}

/**
 * Create one Topic per non-empty line of the pasted list, skipping names an existing Topic
 * (or an earlier line) already has. Imported Topics have no Source, so no Explainer is made
 * for them until a Source is linked (ADR 0001).
 */
export async function importTopics(deps: CoreDeps, list: string): Promise<ImportTopicsResult> {
  const names = list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.length === 0) throw new ValidationError("Paste at least one Topic, one per line.");

  const existing = await deps.db
    .select({ key: sql<string>`lower(${topics.name})` })
    .from(topics);
  const taken = new Set(existing.map((t) => t.key));
  const toCreate: string[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (taken.has(key)) {
      skipped.push(name);
      continue;
    }
    taken.add(key);
    toCreate.push(name);
  }
  if (toCreate.length === 0) return { created: [], skipped };

  const embeddings = await deps.ai.embed(toCreate.map((name) => topicEmbeddingText({ name, description: null })));
  const now = deps.clock.now();
  const rows = await deps.db
    .insert(topics)
    .values(toCreate.map((name, i) => ({ name, description: null, embedding: embeddings[i]!, createdAt: now })))
    .onConflictDoNothing()
    .returning({ id: topics.id, name: topics.name, description: topics.description });
  const byName = new Map(rows.map((r) => [r.name, r]));
  const created = toCreate
    .map((name) => byName.get(name))
    .filter((r) => r !== undefined)
    .map((r) => ({ ...r, sourceCount: 0 }));
  return { created, skipped };
}

/**
 * The learner links an existing Source to a Topic by hand. This counts as an approved link,
 * exactly like approving a proposed Topic (so it triggers whatever a new link triggers).
 */
export async function linkSourceByHand(
  deps: CoreDeps,
  link: { topicId: string; sourceId: string },
): Promise<TopicSummary> {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const [topic] = await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, link.topicId));
    if (!topic) throw new NotFoundError("That Topic no longer exists.");
    const [source] = await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, link.sourceId));
    if (!source) throw new NotFoundError("That Source no longer exists.");
    await linkSourceToTopic(tx, now, link);
  });
  const { sources: _linked, ...summary } = await getTopic(deps, link.topicId);
  return summary;
}
