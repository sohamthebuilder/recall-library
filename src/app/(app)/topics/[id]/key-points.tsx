"use client";

import Link from "next/link";
import { useState } from "react";
import type { CitedPassage, ExplainerKeyPoint } from "@/core";

/** Key points with numbered citations; tapping a citation shows the cited passage. */
export function KeyPoints({
  keyPoints,
  passages,
}: {
  keyPoints: ExplainerKeyPoint[];
  passages: Record<string, CitedPassage>;
}) {
  // Number citations in order of first appearance, so the same passage keeps its number.
  const numbers = new Map<string, number>();
  for (const p of keyPoints) for (const c of p.citations) if (!numbers.has(c.chunkId)) numbers.set(c.chunkId, numbers.size + 1);

  const [open, setOpen] = useState<{ pointId: string; chunkId: string } | null>(null);

  return (
    <ol className="key-points">
      {keyPoints.map((point) => {
        const shown = open?.pointId === point.id ? passages[open.chunkId] : undefined;
        return (
          <li key={point.id}>
            <span>{point.text}</span>{" "}
            {point.citations.map((c) => {
              const active = open?.pointId === point.id && open.chunkId === c.chunkId;
              return (
                <button
                  key={c.chunkId}
                  type="button"
                  className={`citation${active ? " active" : ""}`}
                  aria-expanded={active}
                  aria-label={`Citation ${numbers.get(c.chunkId)}: show the Source passage`}
                  onClick={() => setOpen(active ? null : { pointId: point.id, chunkId: c.chunkId })}
                >
                  {numbers.get(c.chunkId)}
                </button>
              );
            })}
            {shown ? <Passage passage={shown} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Passage({ passage }: { passage: CitedPassage }) {
  if (passage.status === "source_removed") {
    return <blockquote className="passage muted">Source removed.</blockquote>;
  }
  const { page, seconds } = passage.anchor;
  const where =
    page !== undefined
      ? ` · page ${page}`
      : seconds !== undefined
        ? ` · ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
        : "";
  return (
    <blockquote className="passage">
      <p>{passage.text}</p>
      <footer>
        <Link href={`/sources/${passage.sourceId}`}>{passage.sourceTitle ?? "Untitled Source"}</Link>
        {where}
      </footer>
    </blockquote>
  );
}
