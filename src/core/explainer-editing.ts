import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import { explainers, explainerVersions, topics } from "@/db/schema";
import type { CoreDeps } from "./core";
import { NotFoundError, ValidationError } from "./errors";
import { type ExplainerContent, parseStoredContent } from "./explainer-content";
import {
  type CitedPassage,
  citedPassages,
  type Explainer,
  type ExplainerVersion,
  explainerRow,
  getExplainer,
  saveExplainerVersion,
  toVersion,
} from "./explainers";

/**
 * The learner putting an Explainer in their own words (#17). Each change is saved through
 * `saveExplainerVersion`, so it becomes a new immutable version and the Topic's Recall Prompts
 * are reconciled with it.
 */

export interface EditExplainerTextInput {
  topicId: string;
  /**
   * The version the learner was looking at when they edited. If the Explainer has moved on
   * since (another tab, a form switch), the edit is refused rather than overwriting that change.
   */
  baseVersionId?: string | null;
  title?: string;
  /**
   * The key points in their new order. A point with the `id` of an existing one keeps that
   * point's citations; a point without an id is new and cites nothing. Points left out are removed.
   */
  keyPoints?: { id?: string | null; text: string }[];
  /** The analogy; blank or null removes it. */
  analogy?: string | null;
  /** New labels for diagram nodes, by node id. */
  nodeLabels?: Record<string, string>;
  /** New labels for diagram edges, by edge id; blank or null removes the label. */
  edgeLabels?: Record<string, string | null>;
  /** New labels for diagram groups, by group id. */
  groupLabels?: Record<string, string>;
}

export const STALE_EDIT = "The Explainer changed since you opened it. Reload it and make your edit again.";

/**
 * Change an Explainer's text. Saves a new version (cause `text_edit`); an edit that changes
 * nothing saves nothing. Wording is trimmed. Throws ValidationError if the result is not a
 * valid Explainer (e.g. a blank title or key point).
 */
export async function editExplainerText(deps: CoreDeps, input: EditExplainerTextInput): Promise<Explainer> {
  const { explainerId, versionId, content } = await currentContent(deps, input.topicId);
  if (input.baseVersionId && input.baseVersionId !== versionId) throw new ValidationError(STALE_EDIT);
  const next: ExplainerContent = { ...content };
  if (input.title !== undefined) next.title = input.title.trim();
  if (input.keyPoints !== undefined) {
    const before = new Map(content.keyPoints.map((k) => [k.id, k]));
    const used = new Set(content.keyPoints.map((k) => k.id));
    next.keyPoints = input.keyPoints.map((k) => {
      const existing = k.id ? before.get(k.id) : undefined;
      if (existing) return { id: existing.id, text: k.text.trim(), citations: existing.citations };
      return { id: freshId(used, "kp"), text: k.text.trim(), citations: [] };
    });
  }
  if (input.analogy !== undefined) next.analogy = blankToNull(input.analogy);
  const { nodeLabels = {}, edgeLabels = {}, groupLabels = {} } = input;
  next.diagram = {
    groups: content.diagram.groups.map((g) => (g.id in groupLabels ? { ...g, label: groupLabels[g.id]!.trim() } : g)),
    nodes: content.diagram.nodes.map((n) => (n.id in nodeLabels ? { ...n, label: nodeLabels[n.id]!.trim() } : n)),
    edges: content.diagram.edges.map((e) => (e.id in edgeLabels ? { ...e, label: blankToNull(edgeLabels[e.id]) } : e)),
  };
  if (!isDeepStrictEqual(next, content)) {
    await deps.db.transaction((tx) =>
      saveExplainerVersion(tx, deps.clock.now(), { explainerId, content: next, cause: "text_edit" }),
    );
  }
  return (await getExplainer(deps, input.topicId))!;
}

// ---------------------------------------------------------------------------------------
// Versions

export interface ExplainerVersionRef {
  topicId: string;
  versionId: string;
}

export interface OpenedExplainerVersion {
  version: ExplainerVersion;
  /** Whether this is the version the learner studies now. */
  isCurrent: boolean;
  /** Every passage this version cites, by chunk id. */
  passages: Record<string, CitedPassage>;
}

/** One version of a Topic's Explainer, to look at before restoring it. */
export async function getExplainerVersion(deps: CoreDeps, ref: ExplainerVersionRef): Promise<OpenedExplainerVersion> {
  const { row, currentVersionId } = await versionOfTopic(deps, ref);
  const version = toVersion(row);
  return {
    version,
    isCurrent: version.id === currentVersionId,
    passages: await citedPassages(deps.db, version.content),
  };
}

/**
 * Make an earlier version current again. Its content is saved as a new version (cause
 * `restore`, recording which number was restored); no version is changed or removed.
 */
export async function restoreExplainerVersion(deps: CoreDeps, ref: ExplainerVersionRef): Promise<Explainer> {
  const { row, currentVersionId } = await versionOfTopic(deps, ref);
  if (row.id === currentVersionId) throw new ValidationError("That is already the current version.");
  await deps.db.transaction((tx) =>
    saveExplainerVersion(tx, deps.clock.now(), {
      explainerId: row.explainerId,
      content: row.content,
      cause: "restore",
      causeDetail: { restoredFrom: row.number, restoredFromVersionId: row.id },
    }),
  );
  return (await getExplainer(deps, ref.topicId))!;
}

async function versionOfTopic(deps: CoreDeps, { topicId, versionId }: ExplainerVersionRef) {
  const [topic] = await deps.db.select({ id: topics.id }).from(topics).where(sql`${topics.id}::text = ${topicId}`);
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
  const [found] = await deps.db
    .select({ row: explainerVersions, currentVersionId: explainers.currentVersionId })
    .from(explainerVersions)
    .innerJoin(explainers, eq(explainers.id, explainerVersions.explainerId))
    .where(and(eq(explainers.topicId, topic.id), sql`${explainerVersions.id}::text = ${versionId}`));
  if (!found) throw new NotFoundError("That version of the Explainer does not exist.");
  return found;
}

// ---------------------------------------------------------------------------------------
// Comparing with the Sources

export interface KeyPointComparison {
  keyPointId: string;
  /** The key point as the learner studies it now. */
  text: string;
  /**
   * Who first wrote this key point: the AI when it generated the Explainer, the AI in a
   * Suggested Edit the learner accepted (which also covers a point that edit rewrote), or the learner.
   */
  origin: KeyPointOrigin;
  /** What the AI wrote for this key point (when generated, or in the accepted Suggested Edit); null for a point the learner added. */
  generatedText: string | null;
  /** Whether the learner's text differs from what the AI wrote. */
  edited: boolean;
  /** The Source passages the key point cites (or that their Source was removed). */
  passages: CitedPassage[];
}

export type KeyPointOrigin = "generated" | "suggested_edit" | "learner";

/** The current key points side by side with the Source passages they cite. */
export async function compareExplainerWithSources(deps: CoreDeps, topicId: string): Promise<KeyPointComparison[]> {
  const { explainerId, versionId, content } = await currentContent(deps, topicId);
  const versions = await deps.db
    .select()
    .from(explainerVersions)
    .where(eq(explainerVersions.explainerId, explainerId))
    .orderBy(asc(explainerVersions.number));
  const origins = keyPointOrigins(versions).get(versionId)!;
  const passages = await citedPassages(deps.db, content);
  return content.keyPoints.map((k) => {
    const { origin, text: generatedText } = origins.get(k.id) ?? { origin: "learner" as const, text: null };
    return {
      keyPointId: k.id,
      text: k.text,
      origin,
      generatedText,
      edited: generatedText !== k.text,
      passages: k.citations.map((c) => passages[c.chunkId]!),
    };
  });
}

type Origins = Map<string, { origin: KeyPointOrigin; text: string | null }>;

/**
 * For each version (by id), where each of its key points came from. A point keeps the origin it
 * had in the version before (or, for a restore, in the version restored); a point that is new in
 * a version, or that an accepted Suggested Edit rewrote, takes that version's cause.
 */
function keyPointOrigins(versions: (typeof explainerVersions.$inferSelect)[]): Map<string, Origins> {
  const byVersion = new Map<string, Origins>();
  let previous: Origins = new Map();
  for (const v of versions) {
    const detail = (v.causeDetail ?? {}) as { restoredFromVersionId?: unknown; keyPointId?: unknown };
    const base =
      v.cause === "restore" && typeof detail.restoredFromVersionId === "string"
        ? (byVersion.get(detail.restoredFromVersionId) ?? previous)
        : previous;
    const origins: Origins = new Map();
    for (const k of parseStoredContent(v.content).keyPoints) {
      if (v.cause === "suggested_edit" && detail.keyPointId === k.id) {
        origins.set(k.id, { origin: "suggested_edit", text: k.text });
      } else if (base.has(k.id)) {
        origins.set(k.id, base.get(k.id)!);
      } else if (v.cause === "generated") {
        origins.set(k.id, { origin: "generated", text: k.text });
      } else {
        origins.set(k.id, { origin: "learner", text: null });
      }
    }
    byVersion.set(v.id, origins);
    previous = origins;
  }
  return byVersion;
}

// ---------------------------------------------------------------------------------------

/** The Topic's Explainer and the content of its current version, or NotFound/Validation errors. */
export async function currentContent(deps: CoreDeps, topicId: string) {
  const [topic] = await deps.db.select({ id: topics.id }).from(topics).where(sql`${topics.id}::text = ${topicId}`);
  if (!topic) throw new NotFoundError("That Topic no longer exists.");
  const explainer = await explainerRow(deps.db, topic.id);
  if (!explainer) throw new NotFoundError("That Topic has no Explainer.");
  if (!explainer.currentVersionId) throw new ValidationError("The Explainer is not ready yet.");
  const [row] = await deps.db.select().from(explainerVersions).where(eq(explainerVersions.id, explainer.currentVersionId));
  return { explainerId: explainer.id, versionId: row!.id, content: parseStoredContent(row!.content) };
}

function blankToNull(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** An id with this prefix that is not in `used` (and is then marked used). */
function freshId(used: Set<string>, prefix: string): string {
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  const id = `${prefix}${n}`;
  used.add(id);
  return id;
}
