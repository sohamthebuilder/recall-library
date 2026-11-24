import type { Segment } from "./source-kinds";

/**
 * Where a chunk sits in its Source: character offsets into the Source's stored text
 * (end exclusive), plus the page or timestamp of the segment it was cut from.
 */
export interface ChunkAnchor {
  start: number;
  end: number;
  page?: number;
  seconds?: number;
}

export interface Chunk {
  text: string;
  anchor: ChunkAnchor;
}

/** Segments are joined with this to make the Source's stored text. */
export const SEGMENT_SEPARATOR = "\n\n";

/** Aim for chunks of at most this many characters (roughly 400 tokens). */
const MAX_CHUNK_CHARS = 1600;

export function joinSegments(segments: Segment[]): string {
  return segments.map((s) => s.text).join(SEGMENT_SEPARATOR);
}

/**
 * Split captured text into chunks. Chunks never cross a segment (so each keeps one page or
 * timestamp), prefer paragraph and then sentence boundaries, and never exceed the size limit.
 * Every chunk's text is exactly `joinSegments(segments).slice(anchor.start, anchor.end)`.
 */
export function chunkSegments(segments: Segment[]): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;
  for (const segment of segments) {
    for (const [start, end] of splitRange(segment.text, 0, segment.text.length)) {
      const anchor: ChunkAnchor = { start: offset + start, end: offset + end };
      if (segment.page !== undefined) anchor.page = segment.page;
      if (segment.seconds !== undefined) anchor.seconds = segment.seconds;
      chunks.push({ text: segment.text.slice(start, end), anchor });
    }
    offset += segment.text.length + SEGMENT_SEPARATOR.length;
  }
  return chunks;
}

/** Ranges [start, end) of `text` within [from, to), trimmed of whitespace, packed up to the limit. */
function splitRange(text: string, from: number, to: number): [number, number][] {
  const pieces = pieceRanges(text, from, to);
  const out: [number, number][] = [];
  let current: [number, number] | null = null;
  for (const piece of pieces) {
    if (current && piece[1] - current[0] <= MAX_CHUNK_CHARS) {
      current[1] = piece[1];
    } else {
      if (current) out.push(current);
      current = [piece[0], piece[1]];
    }
  }
  if (current) out.push(current);
  return out;
}

/** Break text into trimmed pieces no longer than the limit: paragraphs, then sentences, then hard cuts. */
function pieceRanges(text: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [ps, pe] of splitOn(text, from, to, /\n\s*\n/g)) {
    if (pe - ps <= MAX_CHUNK_CHARS) {
      out.push([ps, pe]);
      continue;
    }
    for (const [ss, se] of splitOn(text, ps, pe, /(?<=[.!?])\s+/g)) {
      for (let s = ss; s < se; s += MAX_CHUNK_CHARS) out.push([s, Math.min(se, s + MAX_CHUNK_CHARS)]);
    }
  }
  return out;
}

/** Ranges between separator matches, each trimmed; empty ranges dropped. */
function splitOn(text: string, from: number, to: number, separator: RegExp): [number, number][] {
  const slice = text.slice(from, to);
  const ranges: [number, number][] = [];
  let last = 0;
  for (const m of slice.matchAll(separator)) {
    ranges.push([last, m.index]);
    last = m.index + m[0].length;
  }
  ranges.push([last, slice.length]);
  return ranges.flatMap(([s, e]) => {
    while (s < e && /\s/.test(slice[s]!)) s++;
    while (e > s && /\s/.test(slice[e - 1]!)) e--;
    return e > s ? [[from + s, from + e] as [number, number]] : [];
  });
}
