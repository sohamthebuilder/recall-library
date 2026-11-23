import { describe, expect, it, vi } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./errors";

describe("processing a Source in the background", () => {
  it("leaves a new Source pending until background jobs run, then makes it ready", async () => {
    const { core } = await createTestCore();

    const note = await core.addSource({ kind: "note", text: "Consumer groups share partitions." });
    expect((await core.source(note.id)).status).toBe("pending");

    await core.runJobs();

    expect((await core.source(note.id)).status).toBe("ready");
  });

  it("proposes Topics from the Source's text while it is proposing_topics, all new in an empty Library", async () => {
    const { core, ai } = await createTestCore();
    const text = "Kafka consumer groups share partitions. Offsets record progress.";
    let statusWhileProposing: string | undefined;
    ai.scriptTopicProposals(text, async () => {
      statusWhileProposing = (await core.library()).sources[0]?.status;
      return [
        { name: "Kafka consumer groups", description: "How consumers share partitions" },
        { name: "Kafka offsets", description: "How progress is recorded" },
      ];
    });

    const note = await core.addSource({ kind: "note", title: "Kafka", text });
    await core.runJobs();

    expect(statusWhileProposing).toBe("proposing_topics");
    expect(await core.topicProposals(note.id)).toEqual([
      expect.objectContaining({ name: "Kafka consumer groups", status: "pending", match: null }),
      expect.objectContaining({ name: "Kafka offsets", status: "pending", match: null }),
    ]);
    expect(await core.topics()).toEqual([]);
  });
});

describe("a Source's captured text", () => {
  it("is split into anchored chunks that together cover the text", async () => {
    const { core } = await createTestCore();
    const paragraph = (n: number) => `Paragraph ${n}. ` + "Partitions are assigned to consumers. ".repeat(20);
    const text = Array.from({ length: 6 }, (_, i) => paragraph(i + 1)).join("\n\n").trim();

    const note = await core.addSource({ kind: "note", text });
    expect(await core.sourceChunks(note.id)).toEqual([]);
    await core.runJobs();

    const source = await core.source(note.id);
    const chunks = await core.sourceChunks(note.id);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1600);
      expect(source.text!.slice(chunk.anchor.start, chunk.anchor.end)).toBe(chunk.text);
    }
    expect(chunks[0]!.text.startsWith("Paragraph 1.")).toBe(true);
    expect(chunks.at(-1)!.text.endsWith("consumers.")).toBe(true);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("is embedded, so the chunks nearest a question can be found", async () => {
    const { core, ai } = await createTestCore();
    ai.scriptEmbedding("Offsets record how far a consumer has read.", [1, 0, 0])
      .scriptEmbedding("Rebalancing reassigns partitions.", [0, 1, 0])
      .scriptEmbedding("where is my consumer up to?", [0.9, 0.1, 0]);
    await core.addSource({ kind: "note", text: "Offsets record how far a consumer has read." });
    await core.addSource({ kind: "note", text: "Rebalancing reassigns partitions." });
    await core.runJobs();

    const nearest = await core.similarChunks({ text: "where is my consumer up to?", limit: 1 });

    expect(nearest.map((c) => c.text)).toEqual(["Offsets record how far a consumer has read."]);
  });
});

describe("when processing fails", () => {
  it("marks the Source failed with the reason, and a retry processes it again", async () => {
    const { core, ai } = await createTestCore();
    const text = "Idempotency keys make retries safe.";
    ai.scriptTopicProposalFailure(text, "The AI service is busy. Try again later.").scriptTopicProposals(text, [
      { name: "Idempotency keys", description: null },
    ]);

    const note = await core.addSource({ kind: "note", text });
    await core.runJobs();

    expect(await core.source(note.id)).toMatchObject({
      status: "failed",
      failureReason: "The AI service is busy. Try again later.",
    });
    expect(await core.topicProposals(note.id)).toEqual([]);

    await core.retrySource(note.id);
    expect(await core.source(note.id)).toMatchObject({ status: "pending", failureReason: null });
    await core.runJobs();

    expect(await core.source(note.id)).toMatchObject({ status: "ready", failureReason: null });
    expect((await core.topicProposals(note.id)).map((p) => p.name)).toEqual(["Idempotency keys"]);
    expect((await core.sourceChunks(note.id)).map((c) => c.text)).toEqual([text]);
  });

  it("refuses to retry a Source that has not failed", async () => {
    const { core } = await createTestCore();
    const note = await core.addSource({ kind: "note", text: "Fine." });
    await core.runJobs();

    await expect(core.retrySource(note.id)).rejects.toThrow(ValidationError);
  });

  it("shows a general reason when something unexpected breaks, and still lets the learner retry", async () => {
    const { core, ai } = await createTestCore();
    const text = "Backpressure slows producers.";
    let broken = true;
    ai.scriptTopicProposals(text, () => {
      if (broken) throw new Error("socket hang up");
      return [];
    });

    const note = await core.addSource({ kind: "note", text });
    const run = await core.runJobs();

    expect(run).toEqual({ ran: 1, failed: 1 });
    const failed = await core.source(note.id);
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).not.toContain("socket");

    broken = false;
    await core.retrySource(note.id);
    await core.runJobs();
    expect((await core.source(note.id)).status).toBe("ready");
  });
});

describe("a job whose process died while running it", () => {
  it("is run again a few times, then given up: the Source fails with a reason the learner can read", async () => {
    const t = await createTestCore({ now: new Date("2026-03-01T10:00:00Z") });
    const url = "https://blog.example.com/never-answers";
    t.contentFetcher.scriptArticleHang(url);
    const source = await t.core.addSource({ kind: "url", url });

    for (let attempt = 1; attempt <= 3; attempt++) {
      void t.core.runJobs({ maxJobs: 1 }); // Never finishes: its process "died" mid-job.
      await vi.waitFor(() => expect(t.contentFetcher.hungFetches).toBe(attempt));
      t.clock.set(new Date(t.clock.now().getTime() + 16 * 60 * 1000));
    }
    await t.core.runJobs({ maxJobs: 1 });

    expect(t.contentFetcher.hungFetches).toBe(3);
    expect(await t.core.source(source.id)).toMatchObject({
      status: "failed",
      failureReason: "Processing this Source kept stopping before it finished. Try again.",
    });
    // Retrying starts over with a fresh job.
    t.contentFetcher.scriptArticle(url, { title: "Back", text: "It answers now." });
    await t.core.retrySource(source.id);
    await t.core.runJobs();
    expect((await t.core.source(source.id)).status).toBe("ready");
  });
});
