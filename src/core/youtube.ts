/**
 * YouTube URLs. Client-safe (no server imports), so the UI can also use it, e.g. to route a
 * pasted link to the right Source kind.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"]);

/**
 * The video id of a YouTube video URL (watch, youtu.be, shorts, embed and live links),
 * or null if the text is not one.
 */
export function parseYouTubeVideoId(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id: string | null | undefined = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live" || first === "v") id = second;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function isYouTubeUrl(text: string): boolean {
  return parseYouTubeVideoId(text) !== null;
}

/** The canonical link to a video, optionally starting at a moment in it. */
export function youTubeWatchUrl(videoId: string, seconds?: number): string {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return seconds === undefined ? url : `${url}&t=${Math.floor(seconds)}s`;
}
