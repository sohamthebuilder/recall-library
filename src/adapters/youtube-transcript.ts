import { ContentFetchError, type TranscriptCue, type YouTubeTranscript } from "@/core/ports/content-fetcher";

/**
 * The real YouTube transcript fetcher. No API key or SDK: it does what the YouTube page does.
 * 1. Load the watch page for the Innertube API key.
 * 2. Ask the Innertube player endpoint (as the Android app) for the video's title and caption tracks.
 * 3. Download the best caption track (human-made English, then auto-generated English, then any)
 *    and parse its timed text (srv3 `<p t= d=>` or the older `<text start= dur=>` format).
 *
 * Checked against saved sample responses in test/fixtures/youtube (no live network in tests).
 * YouTube changes these internals from time to time; if transcripts start failing, refresh the
 * samples from a real video and adjust here.
 */
export interface YouTubeTranscriptFetcherOptions {
  fetch?: typeof fetch;
}

const ORIGIN = "https://www.youtube.com";
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38" };
const BROWSER_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Skip the EU cookie consent interstitial.
  cookie: "CONSENT=YES+cb",
};

const UNREACHABLE = "Could not reach YouTube. Try again.";
const UNEXPECTED = "YouTube didn't return this video's transcript as expected. Try again later.";

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

export function createYouTubeTranscriptFetcher(options: YouTubeTranscriptFetcherOptions = {}) {
  const doFetch = options.fetch ?? fetch;

  async function get(url: string, init?: RequestInit): Promise<string> {
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch {
      throw new ContentFetchError(UNREACHABLE);
    }
    if (!res.ok) {
      console.error(`YouTube request failed: ${res.status} ${url.split("?")[0]}`);
      throw new ContentFetchError(res.status === 429 ? "YouTube is limiting requests right now. Try again later." : UNREACHABLE);
    }
    return res.text();
  }

  return {
    async fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscript | null> {
      const page = await get(`${ORIGIN}/watch?v=${encodeURIComponent(videoId)}`, { headers: BROWSER_HEADERS });
      const apiKey = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(page)?.[1];
      if (!apiKey) throw new ContentFetchError(UNEXPECTED);

      const playerJson = await get(`${ORIGIN}/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
        method: "POST",
        headers: { ...BROWSER_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ context: { client: { ...ANDROID_CLIENT, hl: "en" } }, videoId }),
      });
      let player: PlayerResponse;
      try {
        player = JSON.parse(playerJson) as PlayerResponse;
      } catch {
        throw new ContentFetchError(UNEXPECTED);
      }

      const status = player.playabilityStatus?.status;
      if (status && status !== "OK") {
        throw new ContentFetchError(
          `YouTube says this video can't be played${player.playabilityStatus?.reason ? ` ("${player.playabilityStatus.reason}")` : ""}. It may be private, age-restricted or unavailable.`,
        );
      }
      const title = player.videoDetails?.title?.trim() || null;
      const track = chooseTrack(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
      if (!track) return null;

      const timedText = await get(track.baseUrl, { headers: BROWSER_HEADERS });
      const cues = parseTimedText(timedText);
      if (cues.length === 0) throw new ContentFetchError(UNEXPECTED);
      return { title, cues };
    },
  };
}

/** Human-made English, then auto-generated English, then any human-made track, then anything. */
function chooseTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const english = (t: CaptionTrack) => /^en\b/i.test(t.languageCode ?? "");
  const manual = (t: CaptionTrack) => t.kind !== "asr";
  return (
    tracks.find((t) => english(t) && manual(t)) ??
    tracks.find(english) ??
    tracks.find(manual) ??
    tracks[0]
  );
}

/** Cues from YouTube timed text, in either the srv3 (`<p t="ms">`) or srv1 (`<text start="s">`) format. */
export function parseTimedText(xml: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const srv3 = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  const srv1 = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  for (const [, attrs, body] of xml.matchAll(srv3)) {
    const t = attr(attrs!, "t");
    if (t !== null) push(cues, Number(t) / 1000, body!);
  }
  if (cues.length === 0) {
    for (const [, attrs, body] of xml.matchAll(srv1)) {
      const start = attr(attrs!, "start");
      if (start !== null) push(cues, Number(start), body!);
    }
  }
  return cues;
}

function attr(attrs: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
}

function push(cues: TranscriptCue[], seconds: number, body: string) {
  // srv1 bodies are escaped twice (`&amp;#39;`), so decode until nothing changes.
  let text = body.replace(/<[^>]*>/g, "");
  for (let i = 0; i < 2; i++) text = decodeEntities(text);
  text = text.replace(/\s+/g, " ").trim();
  if (text && Number.isFinite(seconds)) cues.push({ seconds, text });
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}
