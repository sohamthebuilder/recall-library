import type { ExplainerDiagram } from "@/core";
import { type Direction, layoutDiagram } from "./diagram-layout";

/** The Explainer's diagram as SVG: left-to-right on a laptop, top-to-bottom on a phone. */
export function ExplainerDiagramView({ diagram, title }: { diagram: ExplainerDiagram; title: string }) {
  if (diagram.nodes.length === 0) return null;
  const labelOf = new Map(diagram.nodes.map((n) => [n.id, n.label]));
  return (
    <figure className="diagram">
      {diagram.groups.length > 0 ? (
        <ul className="diagram-legend" aria-label="Groups">
          {diagram.groups.map((g, i) => (
            <li key={g.id}>
              <span className={`swatch group-${i % 6}`} aria-hidden="true" />
              {g.label}
            </li>
          ))}
        </ul>
      ) : null}
      <DiagramSvg diagram={diagram} direction="horizontal" title={title} />
      <DiagramSvg diagram={diagram} direction="vertical" title={title} />
      <details className="diagram-text">
        <summary>Diagram as text</summary>
        <ul>
          {diagram.edges.map((e) => (
            <li key={e.id}>
              {labelOf.get(e.from)} → {e.label ? `${e.label} → ` : ""}
              {labelOf.get(e.to)}
            </li>
          ))}
          {diagram.nodes
            .filter((n) => !diagram.edges.some((e) => e.from === n.id || e.to === n.id))
            .map((n) => (
              <li key={n.id}>{n.label}</li>
            ))}
        </ul>
      </details>
    </figure>
  );
}

function DiagramSvg({ diagram, direction, title }: { diagram: ExplainerDiagram; direction: Direction; title: string }) {
  const layout = layoutDiagram(diagram, direction);
  const marker = `arrow-${direction}`;
  return (
    <svg
      className={`diagram-svg diagram-${direction}`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ maxWidth: layout.width }}
      role="img"
      aria-label={`Diagram: ${title}`}
    >
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="diagram-arrowhead" />
        </marker>
      </defs>
      {layout.edges.map((e) => (
        <path key={e.id} d={e.path} className="diagram-edge" markerEnd={`url(#${marker})`} />
      ))}
      {layout.nodes.map((n) => (
        <g key={n.id} className={n.groupIndex >= 0 ? `group-${n.groupIndex % 6}` : "group-none"}>
          <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={8} className="diagram-node" />
          <text x={n.x + n.width / 2} y={n.y + 14 + 13} textAnchor="middle" className="diagram-node-label">
            {n.lines.map((line, i) => (
              <tspan key={i} x={n.x + n.width / 2} dy={i === 0 ? 0 : 18}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      ))}
      {layout.edges.map((e) =>
        e.label ? (
          <text key={e.id} x={e.labelX} y={e.labelY - 4} textAnchor="middle" className="diagram-edge-label">
            {e.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
