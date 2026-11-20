import { and, asc, count, eq, inArray, notExists, type SQL, sql } from "drizzle-orm";
import { tags, topicSources, topicTags, topics } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import type { TopicSummary } from "./topics";

/** A flat label grouping related Topics. Tags have no hierarchy. */
export interface Tag {
  id: string;
  name: string;
}

const byTagName = sql`lower(${tags.name})`;

/**
 * Put a Tag on a Topic. An existing Tag with the same name (ignoring case) is reused;
 * otherwise the Tag is created. Tagging a Topic with a Tag it already has does nothing.
 */
export async function tagTopic(deps: CoreDeps, input: { topicId: string; name: string }): Promise<Tag> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError("A Tag needs a name.");
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    await assertTopicExists(tx, input.topicId);
    await pruneUnusedTags(tx);
    await tx.insert(tags).values({ name, createdAt: now }).onConflictDoNothing();
    const [tag] = await tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(sql`${byTagName} = lower(${name})`);
    await tx.insert(topicTags).values({ topicId: input.topicId, tagId: tag!.id }).onConflictDoNothing();
    return tag!;
  });
}

/** Take a Tag off a Topic. A Tag left on no Topic is gone. Removing a Tag the Topic lacks does nothing. */
export async function untagTopic(deps: CoreDeps, input: { topicId: string; tagId: string }): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await assertTopicExists(tx, input.topicId);
    await tx
      .delete(topicTags)
      .where(and(eq(topicTags.topicId, input.topicId), eq(topicTags.tagId, input.tagId)));
    await pruneUnusedTags(tx);
  });
}

/**
 * Tags only exist while some Topic has them. Deleting a Topic can leave Tags unused (its
 * topic_tags rows cascade away), so this also runs before tagging.
 */
async function pruneUnusedTags(tx: DbOrTx) {
  await tx.delete(tags).where(notExists(tx.select().from(topicTags).where(eq(topicTags.tagId, tags.id))));
}

export interface TagSummary extends Tag {
  /** How many Topics have this Tag. */
  topicCount: number;
}

/** Every Tag in use on at least one Topic, by name. */
export async function listTags(deps: CoreDeps): Promise<TagSummary[]> {
  return deps.db
    .select({ id: tags.id, name: tags.name, topicCount: count(topicTags.topicId) })
    .from(tags)
    .innerJoin(topicTags, eq(topicTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(byTagName));
}

/** The Tags on a Topic, by name. */
export async function tagsOfTopic(db: DbOrTx, topicId: string): Promise<Tag[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(eq(topicTags.topicId, topicId))
    .orderBy(asc(byTagName));
}

export interface FindTopicsInput {
  /** Only Topics whose name contains this text (ignoring case). Blank means no search. */
  search?: string | null;
  /** Only Topics that have every one of these Tags. Empty means no filter. */
  tagIds?: readonly string[];
}

export interface TaggedTopicSummary extends TopicSummary {
  /** The Topic's Tags, by name. */
  tags: Tag[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find Topics by name and/or Tags, by name, each with its Tags. This is the Topics-by-Tag
 * read: e.g. Practice by Tag is `findTopics({ tagIds: [tagId] })`.
 */
export async function findTopics(deps: CoreDeps, input: FindTopicsInput = {}): Promise<TaggedTopicSummary[]> {
  const search = input.search?.trim() || null;
  const tagIds = [...new Set(input.tagIds ?? [])];
  // An id that cannot be a Tag matches no Topic (and must not reach Postgres as a uuid).
  if (tagIds.some((id) => !UUID.test(id))) return [];

  const conditions: SQL[] = [];
  if (search) conditions.push(sql`strpos(lower(${topics.name}), lower(${search})) > 0`);
  if (tagIds.length > 0) {
    conditions.push(
      inArray(
        topics.id,
        deps.db
          .select({ topicId: topicTags.topicId })
          .from(topicTags)
          .where(inArray(topicTags.tagId, tagIds))
          .groupBy(topicTags.topicId)
          .having(sql`count(*) = ${tagIds.length}`),
      ),
    );
  }

  const found = await deps.db
    .select({
      id: topics.id,
      name: topics.name,
      description: topics.description,
      sourceCount: count(topicSources.sourceId),
    })
    .from(topics)
    .leftJoin(topicSources, eq(topicSources.topicId, topics.id))
    .where(and(...conditions))
    .groupBy(topics.id)
    .orderBy(sql`lower(${topics.name})`);
  if (found.length === 0) return [];

  const tagRows = await deps.db
    .select({ topicId: topicTags.topicId, id: tags.id, name: tags.name })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(
      inArray(
        topicTags.topicId,
        found.map((t) => t.id),
      ),
    )
    .orderBy(asc(byTagName));
  const tagsByTopic = new Map<string, Tag[]>();
  for (const { topicId, id, name } of tagRows) {
    tagsByTopic.set(topicId, [...(tagsByTopic.get(topicId) ?? []), { id, name }]);
  }
  return found.map((t) => ({ ...t, tags: tagsByTopic.get(t.id) ?? [] }));
}

async function assertTopicExists(db: DbOrTx, topicId: string) {
  const [topic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
}
