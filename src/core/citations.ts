import type { ChunkAnchor } from "./chunking";
import type { SourceKind } from "./sources";
import { parseYouTubeVideoId, youTubeWatchUrl } from "./youtube";

/**
 * Where a citation of a Source (optionally of one chunk of it) should link to: for a video,
 * the moment the chunk is spoken; for a web page, the page. Null when the Source has nothing
 * to link to outside the app (a Note, an uploaded file). Client-safe.
 */
export function citationUrl(
  source: { kind: SourceKind; reference: string | null },
  anchor?: Pick<ChunkAnchor, "seconds">,
): string | null {
  if (!source.reference) return null;
  switch (source.kind) {
    case "youtube": {
      const videoId = parseYouTubeVideoId(source.reference);
      return videoId ? youTubeWatchUrl(videoId, anchor?.seconds) : source.reference;
    }
    case "url":
      return source.reference;
    default:
      return null;
  }
}
