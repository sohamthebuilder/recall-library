import { and, asc, cosineDistance, count, desc, eq, sql } from "drizzle-orm";
import { sources, topicProposals, topicSources, topics } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { onSourceLinked } from "./explainers";
import type { TopicCandidate } from "./ports/ai";
import { type Source, sourceRow, toSource } from "./sources";
import { type Tag, tagsOfTopic } from "./tags";

/** How many nearest existing Topics the AI is asked to choose a match from. */
const MATCH_CANDIDATES = 5;
/** Existing Topics less similar than this (cosine) are never offered as a match. */
const MATCH_MIN_SIMILARITY = 0.5;

export interface TopicSummary {
  id: string;
  name: string;
  description: string | null;
  /** How many Sources the Topic draws on (approved links only). */
  sourceCount: number;
}

export interface TopicDetail extends TopicSummary {
  /** The Sources the Topic draws on, newest link first. */
  sources: Source[];
  /** The Topic's Tags, by name. */
  tags: Tag[];
}

export type TopicProposalStatus = "pending" | "approved" | "rejected";

export interface TopicProposal {
  id: string;
  sourceId: string;
  name: string;
  description: string | null;
  status: TopicProposalStatus;
  /** The existing Topic the AI matched this proposal to, or null if it is a new Topic. */
  match: { topicId: string; name: string } | null;
  /** Once approved or merged: the Topic the Source was linked to. */
  resolvedTopic: { topicId: string; name: string } | null;
}

// ---------------------------------------------------------------------------------------
// Proposing (runs inside the process_source job)

/**
 * Ask the AI which Topics the text covers, match each to an existing Topic (nearest by
 * embedding, confirmed by the AI) or mark it new, and store them as pending proposals,
 * replacing any earlier pending proposals for this Source.
 */
export async function proposeTopicsForSource(
  deps: CoreDeps,
  source: { id: string; title: string | null },
  text: string,
): Promise<void> {
  const candidates = dedupeByName(await deps.ai.proposeTopics({ sourceTitle: source.title, text }));
  const embeddings = candidates.length ? await deps.ai.embed(candidates.map(topicEmbeddingText)) : [];

  const matches: (string | null)[] = [];
  for (const [i, candidate] of candidates.entries()) {
    matches.push(await matchExistingTopic(deps, candidate, embeddings[i]!));
  }

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .delete(topicProposals)
      .where(and(eq(topicProposals.sourceId, source.id), eq(topicProposals.status, "pending")));
    if (candidates.length === 0) return;
    await tx.insert(topicProposals).values(
      candidates.map((c, i) => ({
        sourceId: source.id,
        ordinal: i,
        name: c.name,
        description: c.description,
        matchedTopicId: matches[i],
        createdAt: now,
      })),
    );
  });
}

async function matchExistingTopic(
  deps: CoreDeps,
  candidate: TopicCandidate,
  embedding: number[],
): Promise<string | null> {
  // An existing Topic with exactly this name is the same Topic; no AI call needed.
  const [sameName] = await deps.db
    .select({ id: topics.id })
    .from(topics)
    .where(sql`lower(${topics.name}) = lower(${candidate.name})`);
  if (sameName) return sameName.id;

  const distance = cosineDistance(topics.embedding, embedding);
  const nearest = await deps.db
    .select({ id: topics.id, name: topics.name, description: topics.description, distance })
    .from(topics)
    .where(sql`${distance} <= ${1 - MATCH_MIN_SIMILARITY}`)
    .orderBy(distance)
    .limit(MATCH_CANDIDATES);
  if (nearest.length === 0) return null;

  const existing = nearest.map(({ id, name, description }) => ({ id, name, description }));
  const chosen = await deps.ai.confirmTopicMatch({ candidate, existing });
  return existing.some((t) => t.id === chosen) ? chosen : null;
}

function dedupeByName(candidates: TopicCandidate[]): TopicCandidate[] {
  const seen = new Set<string>();
  const out: TopicCandidate[] = [];
  for (const c of candidates) {
    const name = c.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, description: c.description?.trim() || null });
  }
  return out;
}

/** The text embedded for a Topic, and for a proposed Topic when matching it against them. */
export function topicEmbeddingText(t: { name: string; description: string | null }): string {
  return t.description ? `${t.name}: ${t.description}` : t.name;
}

// ---------------------------------------------------------------------------------------
// Reading

export async function topicProposalsForSource(deps: CoreDeps, sourceId: string): Promise<TopicProposal[]> {
  await sourceRow(deps, sourceId);
  const matched = sql<string | null>`(select name from ${topics} where ${topics.id} = ${topicProposals.matchedTopicId})`;
  const resolved = sql<string | null>`(select name from ${topics} where ${topics.id} = ${topicProposals.resolvedTopicId})`;
  const rows = await deps.db
    .select({ p: topicProposals, matchedName: matched, resolvedName: resolved })
    .from(topicProposals)
    .where(eq(topicProposals.sourceId, sourceId))
    .orderBy(asc(topicProposals.ordinal));
  return rows.map(({ p, matchedName, resolvedName }) => ({
    id: p.id,
    sourceId: p.sourceId,
    name: p.name,
    description: p.description,
    status: p.status,
    match: p.matchedTopicId && matchedName ? { topicId: p.matchedTopicId, name: matchedName } : null,
    resolvedTopic:
      p.resolvedTopicId && resolvedName ? { topicId: p.resolvedTopicId, name: resolvedName } : null,
  }));
}

/** Every Topic, by name. */
export async function listTopics(deps: CoreDeps): Promise<TopicSummary[]> {
  const rows = await deps.db
    .select({
      id: topics.id,
      name: topics.name,
      description: topics.description,
      sourceCount: count(topicSources.sourceId),
    })
    .from(topics)
    .leftJoin(topicSources, eq(topicSources.topicId, topics.id))
    .groupBy(topics.id)
    .orderBy(sql`lower(${topics.name})`);
  return rows;
}

export async function getTopic(deps: CoreDeps, topicId: string): Promise<TopicDetail> {
  const [topic] = await deps.db.select().from(topics).where(eq(topics.id, topicId));
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
  const linked = await deps.db
    .select({ source: sources })
    .from(topicSources)
    .innerJoin(sources, eq(sources.id, topicSources.sourceId))
    .where(eq(topicSources.topicId, topicId))
    .orderBy(desc(topicSources.linkedAt));
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    sourceCount: linked.length,
    sources: linked.map((r) => toSource(r.source)),
    tags: await tagsOfTopic(deps.db, topicId),
  };
}

// ---------------------------------------------------------------------------------------
// The learner's decisions

export interface ApproveTopicInput {
  proposalId: string;
  /**
   * Rename: create the Topic under this name instead of the proposed one. Also approves a
   * matched proposal as a new Topic rather than linking it to its match.
   */
  name?: string | null;
}

/**
 * Approve a proposed Topic. A matched proposal links the Source to the existing Topic; a new
 * one (or a renamed one) creates the Topic and links the Source to it.
 */
export async function approveTopic(deps: CoreDeps, input: ApproveTopicInput): Promise<TopicSummary> {
  const proposal = await pendingProposal(deps, input.proposalId);
  const rename = input.name?.trim() || null;
  if (input.name !== undefined && input.name !== null && !rename) {
    throw new ValidationError("A Topic needs a name.");
  }

  if (proposal.matchedTopicId && !rename) {
    return linkProposalTo(deps, proposal, proposal.matchedTopicId);
  }

  const name = rename ?? proposal.name;
  const description = proposal.description;
  const [embedding] = await deps.ai.embed([topicEmbeddingText({ name, description })]);
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    await assertNameFree(tx, name);
    const [topic] = await tx
      .insert(topics)
      .values({ name, description, embedding: embedding!, createdAt: now })
      .returning();
    await resolveProposal(tx, now, proposal, topic!.id);
    return summary(tx, topic!.id);
  });
}

/** Approve a proposed Topic as part of an existing Topic: link the Source to that Topic instead. */
export async function mergeTopic(
  deps: CoreDeps,
  input: { proposalId: string; intoTopicId: string },
): Promise<TopicSummary> {
  const proposal = await pendingProposal(deps, input.proposalId);
  return linkProposalTo(deps, proposal, input.intoTopicId);
}

/** Reject a proposed Topic: the Source is not linked to anything for it. */
export async function rejectTopic(deps: CoreDeps, proposalId: string): Promise<void> {
  await pendingProposal(deps, proposalId);
  await deps.db.update(topicProposals).set({ status: "rejected" }).where(eq(topicProposals.id, proposalId));
}

/** Delete a Topic and its links to Sources. The Sources stay in the Library. */
export async function deleteTopic(deps: CoreDeps, topicId: string): Promise<void> {
  const deleted = await deps.db.delete(topics).where(eq(topics.id, topicId)).returning({ id: topics.id });
  if (deleted.length === 0) throw new NotFoundError("That Topic no longer exists.");
}

async function linkProposalTo(
  deps: CoreDeps,
  proposal: typeof topicProposals.$inferSelect,
  topicId: string,
): Promise<TopicSummary> {
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [topic] = await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
    if (!topic) throw new NotFoundError("That Topic no longer exists.");
    await resolveProposal(tx, now, proposal, topicId);
    return summary(tx, topicId);
  });
}

async function resolveProposal(
  tx: DbOrTx,
  now: Date,
  proposal: typeof topicProposals.$inferSelect,
  topicId: string,
): Promise<void> {
  await tx
    .update(topicProposals)
    .set({ status: "approved", resolvedTopicId: topicId })
    .where(eq(topicProposals.id, proposal.id));
  await linkSourceToTopic(tx, now, { topicId, sourceId: proposal.sourceId });
}

/**
 * The one place a Topic–Source link is made. Later work that reacts to a new link
 * (generating an Explainer, Suggested Edits) hooks in here, e.g. by enqueueing a job.
 * Returns false if the link already existed.
 */
export async function linkSourceToTopic(
  tx: DbOrTx,
  now: Date,
  link: { topicId: string; sourceId: string },
): Promise<boolean> {
  const inserted = await tx
    .insert(topicSources)
    .values({ ...link, linkedAt: now })
    .onConflictDoNothing()
    .returning({ topicId: topicSources.topicId });
  if (inserted.length === 0) return false;
  await onSourceLinked(tx, now, link);
  return true;
}

async function pendingProposal(deps: CoreDeps, proposalId: string) {
  const [proposal] = await deps.db.select().from(topicProposals).where(eq(topicProposals.id, proposalId));
  if (!proposal) throw new NotFoundError("That proposed Topic no longer exists.");
  if (proposal.status !== "pending") throw new ValidationError("That proposed Topic has already been decided.");
  return proposal;
}

async function assertNameFree(tx: DbOrTx, name: string) {
  const [existing] = await tx
    .select({ name: topics.name })
    .from(topics)
    .where(sql`lower(${topics.name}) = lower(${name})`);
  if (existing) {
    throw new ValidationError(`A Topic called "${existing.name}" already exists. Merge into it instead.`);
  }
}

async function summary(db: DbOrTx, topicId: string): Promise<TopicSummary> {
  const [row] = await db
    .select({
      id: topics.id,
      name: topics.name,
      description: topics.description,
      sourceCount: count(topicSources.sourceId),
    })
    .from(topics)
    .leftJoin(topicSources, eq(topicSources.topicId, topics.id))
    .where(eq(topics.id, topicId))
    .groupBy(topics.id);
  return row!;
}
