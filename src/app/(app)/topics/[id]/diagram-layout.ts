import type { ExplainerDiagram } from "@/core";

/**
 * Lays an Explainer diagram out for drawing as SVG. Pure presentation: nodes are put in
 * layers by the longest path from a node with no incoming edge (cycles are broken), then
 * drawn left-to-right (laptop) or top-to-bottom with layers wrapped two nodes a row (phone).
 */

export type Direction = "horizontal" | "vertical";

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  /** Index into diagram.groups, or -1. */
  groupIndex: number;
}

export interface PlacedEdge {
  id: string;
  path: string;
  label: string | null;
  labelX: number;
  labelY: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

const SIZES = {
  horizontal: { nodeWidth: 168, charsPerLine: 20, layerGap: 96, siblingGap: 24, perRow: Infinity },
  vertical: { nodeWidth: 148, charsPerLine: 17, layerGap: 56, siblingGap: 16, perRow: 2 },
} as const;
const LINE_HEIGHT = 18;
const NODE_PADDING = 14;
const MAX_LINES = 3;
const MARGIN = 8;

export function layoutDiagram(diagram: ExplainerDiagram, direction: Direction): DiagramLayout {
  const size = SIZES[direction];
  const layers = layerNodes(diagram);
  const groupIndex = new Map(diagram.groups.map((g, i) => [g.id, i]));

  const boxes = new Map<string, { lines: string[]; height: number; groupIndex: number }>();
  for (const n of diagram.nodes) {
    const lines = wrap(n.label, size.charsPerLine);
    boxes.set(n.id, {
      lines,
      height: lines.length * LINE_HEIGHT + NODE_PADDING * 2,
      groupIndex: n.groupId === null ? -1 : (groupIndex.get(n.groupId) ?? -1),
    });
  }

  const placed = new Map<string, PlacedNode>();
  let width = 0;
  let height = 0;

  if (direction === "horizontal") {
    const columnHeights = layers.map((ids) =>
      ids.reduce((sum, id, i) => sum + boxes.get(id)!.height + (i ? size.siblingGap : 0), 0),
    );
    const tallest = Math.max(0, ...columnHeights);
    layers.forEach((ids, layer) => {
      let y = MARGIN + (tallest - columnHeights[layer]!) / 2;
      const x = MARGIN + layer * (size.nodeWidth + size.layerGap);
      for (const id of ids) {
        const box = boxes.get(id)!;
        placed.set(id, { id, x, y, width: size.nodeWidth, height: box.height, lines: box.lines, groupIndex: box.groupIndex });
        y += box.height + size.siblingGap;
      }
    });
    width = MARGIN * 2 + layers.length * size.nodeWidth + Math.max(0, layers.length - 1) * size.layerGap;
    height = MARGIN * 2 + tallest;
  } else {
    const rowWidth = (n: number) => n * size.nodeWidth + Math.max(0, n - 1) * size.siblingGap;
    width = MARGIN * 2 + rowWidth(Math.min(size.perRow, Math.max(1, ...layers.map((l) => l.length))));
    let y = MARGIN;
    layers.forEach((ids, layer) => {
      if (layer > 0) y += size.layerGap - size.siblingGap;
      for (let start = 0; start < ids.length; start += size.perRow) {
        const row = ids.slice(start, start + size.perRow);
        const rowHeight = Math.max(...row.map((id) => boxes.get(id)!.height));
        let x = (width - rowWidth(row.length)) / 2;
        for (const id of row) {
          const box = boxes.get(id)!;
          placed.set(id, { id, x, y, width: size.nodeWidth, height: box.height, lines: box.lines, groupIndex: box.groupIndex });
          x += size.nodeWidth + size.siblingGap;
        }
        y += rowHeight + size.siblingGap;
      }
    });
    height = y - size.siblingGap + MARGIN;
  }

  const edges: PlacedEdge[] = [];
  for (const e of diagram.edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b) continue;
    const [x1, y1, x2, y2] =
      direction === "horizontal"
        ? [a.x + a.width, a.y + a.height / 2, b.x, b.y + b.height / 2]
        : [a.x + a.width / 2, a.y + a.height, b.x + b.width / 2, b.y];
    const bend = direction === "horizontal" ? Math.max(40, Math.abs(x2 - x1) / 2) : Math.max(30, Math.abs(y2 - y1) / 2);
    const path =
      direction === "horizontal"
        ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
    edges.push({ id: e.id, path, label: e.label, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 });
  }

  return { width, height, nodes: diagram.nodes.map((n) => placed.get(n.id)!).filter(Boolean), edges };
}

/** Nodes by layer: each node one layer after the furthest node pointing at it. Back edges are ignored. */
function layerNodes(diagram: ExplainerDiagram): string[][] {
  const ids = diagram.nodes.map((n) => n.id);
  const known = new Set(ids);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of diagram.edges) if (known.has(e.from) && known.has(e.to) && e.from !== e.to) out.get(e.from)!.push(e.to);

  // Drop back edges found by depth-first search, so what is left is acyclic.
  const state = new Map<string, "visiting" | "done">();
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (id: string) => {
    state.set(id, "visiting");
    for (const next of out.get(id)!) {
      if (state.get(next) === "visiting") continue;
      forward.get(id)!.push(next);
      if (!state.has(next)) visit(next);
    }
    state.set(id, "done");
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    const parents = ids.filter((p) => forward.get(p)!.includes(id));
    const d = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
    layer.set(id, d);
    return d;
  };
  const layers: string[][] = [];
  for (const id of ids) (layers[depth(id)] ??= []).push(id);
  const groupOf = new Map(diagram.nodes.map((n) => [n.id, n.groupId ?? ""]));
  return layers
    .filter(Boolean)
    .map((l) => [...l].sort((a, b) => groupOf.get(a)!.localeCompare(groupOf.get(b)!)));
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1]!.slice(0, width - 1)}…`;
    return kept;
  }
  return lines.length ? lines : [""];
}
