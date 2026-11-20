import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContentFetchError } from "@/core";
import { createYouTubeTranscriptFetcher } from "./youtube-transcript";

// Thin check of the real YouTube transcript fetcher against saved sample responses.
// No live network: `fetch` is replaced by one that serves the sample files.

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../test/fixtures/youtube/${name}`, import.meta.url)), "utf8");

interface Routes {
  watch?: string | number;
  player?: string;
  timedtext?: string;
}

function sampleFetch(routes: Routes) {
  const requests: { url: string; body?: unknown }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = url.startsWith("https://www.youtube.com/watch")
      ? routes.watch
      : url.startsWith("https://www.youtube.com/youtubei/v1/player")
        ? routes.player
        : url.startsWith("https://www.youtube.com/api/timedtext")
          ? routes.timedtext
          : undefined;
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "number") return new Response("", { status: route });
    return new Response(route, { status: 200 });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe("the real YouTube transcript fetcher", () => {
  it("reads the title and the timed transcript, preferring a human-made English track", async () => {
    const { fetch, requests } = sampleFetch({
      watch: fixture("watch-page.html"),
      player: fixture("player-with-captions.json"),
      timedtext: fixture("timedtext-srv3.xml"),
    });

    const transcript = await createYouTubeTranscriptFetcher({ fetch }).fetchYouTubeTranscript("Kx9cVb2hT4Q");

    expect(transcript).toEqual({
      title: "Kafka Consumer Groups Explained",
      cues: [
        { seconds: 0.16, text: "Hi everyone, today we're looking at Kafka consumer groups." },
        { seconds: 4.24, text: "A consumer group shares the partitions of a topic between its members." },
        { seconds: 10.16, text: "When a member joins or leaves, the group rebalances & reassigns partitions." },
        { seconds: 65.02, text: 'Offsets record how far each "consumer" has read.' },
      ],
    });
    expect(requests[0]!.url).toBe("https://www.youtube.com/watch?v=Kx9cVb2hT4Q");
    expect(requests[1]!.url).toContain("key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    expect(requests[1]!.body).toMatchObject({ videoId: "Kx9cVb2hT4Q" });
    expect(requests[2]!.url).toContain("lang=en-GB");
  });

  it("also reads the older timed-text format", async () => {
    const { fetch } = sampleFetch({
      watch: fixture("watch-page.html"),
      player: fixture("player-with-captions.json"),
      timedtext: fixture("timedtext-srv1.xml"),
    });

    const transcript = await createYouTubeTranscriptFetcher({ fetch }).fetchYouTubeTranscript("Kx9cVb2hT4Q");

    expect(transcript?.cues).toEqual([
      { seconds: 0.16, text: "Hi everyone, today we're looking at" },
      { seconds: 4.24, text: "Kafka consumer groups." },
      { seconds: 65.02, text: "Offsets record how far each consumer has read." },
    ]);
  });

  it("resolves null for a video with no captions", async () => {
    const { fetch } = sampleFetch({ watch: fixture("watch-page.html"), player: fixture("player-no-captions.json") });

    expect(await createYouTubeTranscriptFetcher({ fetch }).fetchYouTubeTranscript("Nn0cApt10n5")).toBeNull();
  });

  it("explains that a missing or private video can't be read", async () => {
    const { fetch } = sampleFetch({ watch: fixture("watch-page.html"), player: fixture("player-unavailable.json") });

    const result = createYouTubeTranscriptFetcher({ fetch }).fetchYouTubeTranscript("Gone0000000");

    await expect(result).rejects.toThrow(ContentFetchError);
    await expect(result).rejects.toThrow(/unavailable/i);
  });

  it("explains when YouTube can't be reached", async () => {
    const { fetch } = sampleFetch({ watch: 503 });

    await expect(createYouTubeTranscriptFetcher({ fetch }).fetchYouTubeTranscript("Kx9cVb2hT4Q")).rejects.toThrow(
      ContentFetchError,
    );
  });

  it("explains when YouTube sends back an empty transcript", async () => {
    const { fetch } = sampleFetch({
      watch: fixture("watch-page.html"),
      player: fixture("player-with-captions.json"),
      timedtext: "",
    });

    await expect(createYouTubeTranscriptFetcher({ fetch }).fetchYouTubeTranscript("Kx9cVb2hT4Q")).rejects.toThrow(
      ContentFetchError,
    );
  });
});
