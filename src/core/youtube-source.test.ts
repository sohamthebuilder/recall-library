import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { citationUrl, ValidationError } from "./index";

describe("adding a YouTube video", () => {
  it("captures the transcript, link, title and date captured", async () => {
    const { core, contentFetcher } = await createTestCore({ now: new Date("2026-03-04T10:00:00Z") });
    contentFetcher.scriptYouTubeTranscript("dQw4w9WgXcQ", {
      title: "Kafka in 10 minutes",
      cues: [
        { seconds: 0, text: "Welcome to Kafka." },
        { seconds: 3.5, text: "Consumers share partitions." },
      ],
    });

    const added = await core.addSource({ kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ?si=abc" });
    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({
      kind: "youtube",
      status: "ready",
      title: "Kafka in 10 minutes",
      reference: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      addedAt: new Date("2026-03-04T10:00:00Z"),
      text: "Welcome to Kafka. Consumers share partitions.",
    });
  });

  it("keeps timestamp anchors on its chunks, and citations link to that moment in the video", async () => {
    const { core, contentFetcher } = await createTestCore();
    const line = (n: number) => `Line ${n} talks about partitions, offsets and consumer groups in some detail.`;
    contentFetcher.scriptYouTubeTranscript("abcdefghijk", {
      title: "Long talk",
      cues: Array.from({ length: 60 }, (_, i) => ({ seconds: i * 4.6, text: line(i) })),
    });

    const added = await core.addSource({ kind: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk&t=30s" });
    await core.runJobs();
    const source = await core.source(added.id);
    const chunks = await core.sourceChunks(added.id);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.anchor.seconds).toBe(0);
    for (const chunk of chunks) {
      expect(source.text!.slice(chunk.anchor.start, chunk.anchor.end)).toBe(chunk.text);
      // The chunk starts with the cue spoken at its timestamp.
      const firstLine = Number(/^Line (\d+)/.exec(chunk.text)![1]);
      expect(chunk.anchor.seconds).toBe(Math.floor(firstLine * 4.6));
    }
    const second = chunks[1]!;
    expect(citationUrl(source, second.anchor)).toBe(
      `https://www.youtube.com/watch?v=abcdefghijk&t=${second.anchor.seconds}s`,
    );
    expect(citationUrl(source)).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  });

  it("fails with a message suggesting a Note when the video has no transcript", async () => {
    const { core, contentFetcher } = await createTestCore();
    contentFetcher.scriptYouTubeTranscript("abcdefghijk", null);

    const added = await core.addSource({ kind: "youtube", url: "https://youtu.be/abcdefghijk" });
    await core.runJobs();

    const source = await core.source(added.id);
    expect(source.status).toBe("failed");
    expect(source.failureReason).toMatch(/no transcript/i);
    expect(source.failureReason).toMatch(/add a Note/i);
  });

  it("shows the fetcher's reason when the video can't be fetched, and can be retried", async () => {
    const { core, contentFetcher } = await createTestCore();
    contentFetcher.scriptYouTubeFailure("abcdefghijk", "This video is private or no longer exists.");

    const added = await core.addSource({ kind: "youtube", url: "https://youtu.be/abcdefghijk" });
    await core.runJobs();
    expect(await core.source(added.id)).toMatchObject({
      status: "failed",
      failureReason: "This video is private or no longer exists.",
    });

    contentFetcher.scriptYouTubeTranscript("abcdefghijk", { title: "Back", cues: [{ seconds: 1, text: "Hello." }] });
    await core.retrySource(added.id);
    await core.runJobs();
    expect(await core.source(added.id)).toMatchObject({ status: "ready", title: "Back", text: "Hello." });
  });

  it.each([
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://m.youtube.com/watch?feature=share&v=abcdefghijk",
    "https://youtu.be/abcdefghijk",
    "https://www.youtube.com/shorts/abcdefghijk",
    "https://www.youtube.com/live/abcdefghijk?si=x",
    "https://www.youtube.com/embed/abcdefghijk",
  ])("accepts the link %s and stores the canonical watch link", async (url) => {
    const { core } = await createTestCore();
    const added = await core.addSource({ kind: "youtube", url });
    expect(added).toMatchObject({ kind: "youtube", status: "pending", reference: "https://www.youtube.com/watch?v=abcdefghijk" });
  });

  it.each(["", "not a url", "https://vimeo.com/123456", "https://www.youtube.com/@somechannel", "https://youtu.be/short"])(
    "rejects %j as not a YouTube video link",
    async (url) => {
      const { core } = await createTestCore();
      await expect(core.addSource({ kind: "youtube", url })).rejects.toThrow(ValidationError);
      expect((await core.library()).sources).toEqual([]);
    },
  );
});
