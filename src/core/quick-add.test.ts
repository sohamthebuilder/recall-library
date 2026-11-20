import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./index";

describe("quick add: adding a link pasted or shared from another app", () => {
  it("sends a blog link to the blog URL flow", async () => {
    const { core, contentFetcher } = await createTestCore();
    contentFetcher.scriptArticle("https://blog.example.com/posts/raft", { title: "Raft", text: "Leaders replicate logs." });

    const added = await core.addLink({ text: "https://blog.example.com/posts/raft" });
    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({
      kind: "url",
      reference: "https://blog.example.com/posts/raft",
      title: "Raft",
      status: "ready",
    });
  });

  it("sends a YouTube link to the YouTube flow", async () => {
    const { core, contentFetcher } = await createTestCore();
    contentFetcher.scriptYouTubeTranscript("dQw4w9WgXcQ", { title: "Kafka", cues: [{ seconds: 0, text: "Hi." }] });

    const added = await core.addLink({ text: "https://youtu.be/dQw4w9WgXcQ?si=share" });
    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({
      kind: "youtube",
      reference: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      status: "ready",
    });
  });

  it("picks the link out of shared text that has words around it", async () => {
    const { core } = await createTestCore();

    const article = await core.addLink({
      text: "Worth a read: How Raft elects leaders (https://blog.example.com/posts/raft?ref=share). Via the app",
    });
    const video = await core.addLink({ text: "Kafka in 10 minutes\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ" });

    expect(article).toMatchObject({ kind: "url", reference: "https://blog.example.com/posts/raft?ref=share" });
    expect(video).toMatchObject({ kind: "youtube", reference: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  });

  it("accepts a link typed without https://", async () => {
    const { core } = await createTestCore();

    const article = await core.addLink({ text: " blog.example.com/posts/raft " });
    const video = await core.addLink({ text: "youtu.be/dQw4w9WgXcQ" });

    expect(article).toMatchObject({ kind: "url", reference: "https://blog.example.com/posts/raft" });
    expect(video).toMatchObject({ kind: "youtube", reference: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  });

  it("refuses text with no link in it, adding nothing", async () => {
    const { core } = await createTestCore();

    await expect(core.addLink({ text: "" })).rejects.toThrow(ValidationError);
    await expect(core.addLink({ text: "just some words, no link" })).rejects.toThrow(ValidationError);
    expect((await core.library()).sources).toEqual([]);
  });
});
