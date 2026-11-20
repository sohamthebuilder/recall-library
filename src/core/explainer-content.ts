import { z } from "zod";

/**
 * The structured data of one Explainer version. The app draws it; it is never HTML.
 * Every version's content is validated with `validateExplainerContent` before it is saved.
 *
 * Later tickets extend this in place (keep it backwards compatible with saved versions, or
 * add a parse-time upgrade in `parseStoredContent`).
 */

export const EXPLAINER_FORMS = ["infographic", "animation"] as const;
export type ExplainerForm = (typeof EXPLAINER_FORMS)[number];

const id = z.string().trim().min(1).max(64);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(2000);

/** A citation points at one Source chunk. `sourceId` lets a removed Source still be named as such. */
const citationSchema = z.object({ chunkId: z.string().min(1), sourceId: z.string().min(1) });
/** What the AI returns: just the chunk; the core fills in the Source. */
const draftCitationSchema = z.object({ chunkId: z.string().min(1) });

function contentSchema<C extends z.ZodType>(citation: C) {
  return z
    .object({
      form: z.enum(EXPLAINER_FORMS),
      title: shortText,
      keyPoints: z
        .array(z.object({ id, text: longText, citations: z.array(citation).max(10) }))
        .min(1)
        .max(12),
      analogy: longText.nullable(),
      diagram: z.object({
        groups: z.array(z.object({ id, label: shortText })).max(12),
        nodes: z.array(z.object({ id, label: shortText, groupId: id.nullable() })).max(30),
        edges: z.array(z.object({ id, from: id, to: id, label: shortText.nullable() })).max(60),
      }),
      /** Animation only: each step highlights some diagram nodes/edges with a caption. Empty for an infographic. */
      steps: z
        .array(
          z.object({
            caption: longText,
            highlight: z.object({ nodeIds: z.array(id), edgeIds: z.array(id) }),
          }),
        )
        .max(20),
    })
    .superRefine((c, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: "custom", message });
      const dupes = (ids: string[], what: string) => {
        if (new Set(ids).size !== ids.length) issue(`Duplicate ${what} ids`);
      };
      dupes(c.keyPoints.map((k) => k.id), "key point");
      dupes(c.diagram.groups.map((g) => g.id), "group");
      dupes(c.diagram.nodes.map((n) => n.id), "node");
      dupes(c.diagram.edges.map((e) => e.id), "edge");
      const groups = new Set(c.diagram.groups.map((g) => g.id));
      const nodes = new Set(c.diagram.nodes.map((n) => n.id));
      const edges = new Set(c.diagram.edges.map((e) => e.id));
      for (const n of c.diagram.nodes) if (n.groupId !== null && !groups.has(n.groupId)) issue(`Node ${n.id} is in an unknown group`);
      for (const e of c.diagram.edges) {
        if (!nodes.has(e.from) || !nodes.has(e.to)) issue(`Edge ${e.id} joins an unknown node`);
      }
      for (const s of c.steps) {
        if (s.highlight.nodeIds.some((n) => !nodes.has(n)) || s.highlight.edgeIds.some((e) => !edges.has(e))) {
          issue("A step highlights an unknown part of the diagram");
        }
      }
      if (c.form === "animation" && c.steps.length === 0) issue("An animation needs at least one step");
    });
}

export const explainerContentSchema = contentSchema(citationSchema);
export const explainerDraftSchema = contentSchema(draftCitationSchema);

export type ExplainerContent = z.infer<typeof explainerContentSchema>;
export type ExplainerCitation = z.infer<typeof citationSchema>;
export type ExplainerKeyPoint = ExplainerContent["keyPoints"][number];
export type ExplainerDiagram = ExplainerContent["diagram"];
export type ExplainerStep = ExplainerContent["steps"][number];
/** An Explainer as an AI produces it: citations name only the chunk. */
export type ExplainerDraft = z.infer<typeof explainerDraftSchema>;

export type Validation<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function toValidation<T>(result: z.ZodSafeParseResult<T>): Validation<T> {
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
  };
}

/** Check content is a well-formed Explainer (shape, limits, and that every reference resolves). */
export function validateExplainerContent(input: unknown): Validation<ExplainerContent> {
  return toValidation(explainerContentSchema.safeParse(input));
}

/** Check an AI-produced draft is well-formed. Citations are checked against the passages by the caller. */
export function validateExplainerDraft(input: unknown): Validation<ExplainerDraft> {
  return toValidation(explainerDraftSchema.safeParse(input));
}

/** Content as read back from storage (already validated when saved). */
export function parseStoredContent(stored: unknown): ExplainerContent {
  return stored as ExplainerContent;
}
