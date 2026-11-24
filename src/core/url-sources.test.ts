import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./errors";

const url = "https://blog.example.com/posts/kafka-consumer-groups";

describe("adding a blog URL", () => {
  it("captures the article's readable text, keeps the link and records when it was captured", async () => {
    const { core, contentFetcher, clock } = await createTestCore({ now: new Date("2026-03-01T09:00:00Z") });
    contentFetcher.scriptArticle(url, {
      title: "Kafka consumer groups",
      text: "Consumer groups share partitions.\n\nOffsets record progress.",
    });

    const added = await core.addSource({ kind: "url", url });
    expect(added).toMatchObject({ kind: "url", reference: url, text: null, status: "pending", capturedAt: null });

    clock.set(new Date("2026-03-01T09:05:00Z"));
    await core.runJobs();

    const source = await core.source(added.id);
    expect(source).toMatchObject({
      kind: "url",
      reference: url,
      title: "Kafka consumer groups",
      text: "Consumer groups share partitions.\n\nOffsets record progress.",
      status: "ready",
      addedAt: new Date("2026-03-01T09:00:00Z"),
      capturedAt: new Date("2026-03-01T09:05:00Z"),
    });
  });

  it("goes through processing to Topic proposal like any other Source", async () => {
    const { core, contentFetcher, ai } = await createTestCore();
    const text = "Consumer groups share partitions.";
    contentFetcher.scriptArticle(url, { title: "Kafka", text });
    ai.scriptTopicProposals(text, [{ name: "Kafka consumer groups", description: "Sharing partitions" }]);

    const added = await core.addSource({ kind: "url", url });
    await core.runJobs();

    expect(await core.topicProposals(added.id)).toEqual([
      expect.objectContaining({ name: "Kafka consumer groups", status: "pending" }),
    ]);
    expect((await core.sourceChunks(added.id)).map((c) => c.text)).toEqual([text]);
  });

  it("keeps a title the learner typed over the article's own title", async () => {
    const { core, contentFetcher } = await createTestCore();
    contentFetcher.scriptArticle(url, { title: "Page title", text: "Some text." });

    const added = await core.addSource({ kind: "url", url, title: "My title" });
    await core.runJobs();

    expect((await core.source(added.id)).title).toBe("My title");
  });

  it("refuses something that is not a web link", async () => {
    const { core } = await createTestCore();

    await expect(core.addSource({ kind: "url", url: "" })).rejects.toThrow(ValidationError);
    await expect(core.addSource({ kind: "url", url: "not a link" })).rejects.toThrow(ValidationError);
    await expect(core.addSource({ kind: "url", url: "ftp://example.com/file" })).rejects.toThrow(ValidationError);
    expect((await core.library()).sources).toEqual([]);
  });

  it("accepts a link without a scheme as https, trimming spaces", async () => {
    const { core } = await createTestCore();

    const added = await core.addSource({ kind: "url", url: "  blog.example.com/posts/1 " });

    expect(added.reference).toBe("https://blog.example.com/posts/1");
  });
});

describe("a page that can't be extracted", () => {
  it("fails with the fetcher's reason, and a retry captures it once it works", async () => {
    const { core, contentFetcher } = await createTestCore();
    contentFetcher.scriptArticleFailure(url, "No article text could be found on this page.");

    const added = await core.addSource({ kind: "url", url });
    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({
      status: "failed",
      failureReason: "No article text could be found on this page.",
      text: null,
      capturedAt: null,
    });

    contentFetcher.scriptArticle(url, { title: "Back", text: "It works now." });
    await core.retrySource(added.id);
    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({ status: "ready", text: "It works now.", failureReason: null });
  });
});
