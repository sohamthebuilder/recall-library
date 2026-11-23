import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./errors";
import type { ExtractedPdf } from "./ports/content-fetcher";

const bytes = (s: string) => new TextEncoder().encode(s);

/** A 6-page book: front page, then three chapters in its outline. */
const BOOK_BYTES = "%PDF-1.4 streams book";
const BOOK: ExtractedPdf = {
  title: "Streams in Practice",
  pages: [
    "Streams in Practice\nA short sample book.",
    "Chapter 1: Logs\nA log is an append-only sequence of records.",
    "Each record gets an offset.",
    "Chapter 2: Partitions\nA topic is split into partitions.",
    "Partitions let consumers share the work.",
    "Chapter 3: Consumer groups\nMembers of a group share the partitions.",
  ],
  outline: [
    { title: "Chapter 1: Logs", page: 2 },
    { title: "Chapter 2: Partitions", page: 4 },
    { title: "Chapter 3: Consumer groups", page: 6 },
  ],
};

async function uploadedBook() {
  const t = await createTestCore({ now: new Date("2026-05-01T09:00:00Z") });
  t.contentFetcher.scriptPdf(BOOK_BYTES, BOOK);
  const added = await t.core.addSource({ kind: "pdf", file: { name: "streams.pdf", bytes: bytes(BOOK_BYTES) } });
  return { ...t, added };
}

describe("uploading a PDF", () => {
  it("keeps the file, captures the whole text with page anchors, and proposes no Topics yet", async () => {
    const { core, ai, fileStore, added } = await uploadedBook();
    expect(added).toMatchObject({ kind: "pdf", reference: "streams.pdf", status: "pending" });

    await core.runJobs();

    const source = await core.source(added.id);
    expect(source).toMatchObject({ status: "ready", title: "Streams in Practice" });
    expect(source.text).toContain("A log is an append-only sequence of records.");
    expect(source.text).toContain("Members of a group share the partitions.");
    const chunks = await core.sourceChunks(added.id);
    expect(chunks.find((c) => c.text.includes("Each record gets an offset."))?.anchor.page).toBe(3);
    expect(chunks.find((c) => c.text.includes("Members of a group"))?.anchor.page).toBe(6);
    expect(fileStore.storedFiles()).toMatchObject([{ contentType: "application/pdf" }]);
    expect(await core.topicProposals(added.id)).toEqual([]);
    expect(ai.proposalRequests).toEqual([]);
  });
});

describe("chapters of a PDF", () => {
  it("lists the outline's chapters, with the pages before the first as front matter", async () => {
    const { core, added } = await uploadedBook();
    await core.runJobs();

    expect(await core.sourceChapters(added.id)).toMatchObject([
      { title: "Front matter", startPage: 1, endPage: 1, status: "not_selected" },
      { title: "Chapter 1: Logs", startPage: 2, endPage: 3, status: "not_selected" },
      { title: "Chapter 2: Partitions", startPage: 4, endPage: 5, status: "not_selected" },
      { title: "Chapter 3: Consumer groups", startPage: 6, endPage: 6, status: "not_selected" },
    ]);
  });

  it("offers page ranges of 20 pages when the PDF has no outline", async () => {
    const { core, contentFetcher } = await createTestCore();
    const pages = Array.from({ length: 45 }, (_, i) => `Text of page ${i + 1}.`);
    contentFetcher.scriptPdf("%PDF-1.7 paper", { title: null, pages, outline: [] });
    const added = await core.addSource({ kind: "pdf", file: { name: "paper.pdf", bytes: bytes("%PDF-1.7 paper") } });
    await core.runJobs();

    const chapters = await core.sourceChapters(added.id);
    expect(chapters.map(({ title, startPage, endPage }) => ({ title, startPage, endPage }))).toEqual([
      { title: "Pages 1–20", startPage: 1, endPage: 20 },
      { title: "Pages 21–40", startPage: 21, endPage: 40 },
      { title: "Pages 41–45", startPage: 41, endPage: 45 },
    ]);
    expect((await core.source(added.id)).title).toBeNull();
  });
});

describe("selecting chapters", () => {
  const CHAPTER_1 = "Chapter 1: Logs\nA log is an append-only sequence of records.\n\nEach record gets an offset.";
  const CHAPTER_3 = "Chapter 3: Consumer groups\nMembers of a group share the partitions.";

  it("proposes Topics only from the selected chapters", async () => {
    const { core, ai, added } = await uploadedBook();
    ai.scriptTopicProposals(CHAPTER_1, [{ name: "Commit logs", description: "Append-only records." }]);
    await core.runJobs();
    const [, logs] = await core.sourceChapters(added.id);

    const selected = await core.selectChapters({ sourceId: added.id, chapterIds: [logs!.id] });
    expect(selected[1]).toMatchObject({ title: "Chapter 1: Logs", status: "proposing" });
    expect((await core.source(added.id)).status).toBe("proposing_topics");

    await core.runJobs();

    expect(ai.proposalRequests.map((r) => r.text)).toEqual([CHAPTER_1]);
    expect((await core.topicProposals(added.id)).map((p) => p.name)).toEqual(["Commit logs"]);
    expect((await core.sourceChapters(added.id)).map((c) => c.status)).toEqual([
      "not_selected",
      "proposed",
      "not_selected",
      "not_selected",
    ]);
    expect((await core.source(added.id)).status).toBe("ready");
  });

  it("lets the learner come back for more chapters, keeping the earlier proposals", async () => {
    const { core, ai, added } = await uploadedBook();
    ai.scriptTopicProposals(CHAPTER_1, [{ name: "Commit logs", description: "Append-only records." }]);
    ai.scriptTopicProposals(CHAPTER_3, [
      { name: "Consumer groups", description: "Sharing partitions." },
      { name: "commit logs", description: "Already proposed from chapter 1." },
    ]);
    await core.runJobs();
    const chapters = await core.sourceChapters(added.id);
    await core.selectChapters({ sourceId: added.id, chapterIds: [chapters[1]!.id] });
    await core.runJobs();
    const [first] = await core.topicProposals(added.id);
    await core.approveTopic({ proposalId: first!.id });

    await core.selectChapters({ sourceId: added.id, chapterIds: [chapters[3]!.id] });
    await core.runJobs();

    expect((await core.topicProposals(added.id)).map((p) => [p.name, p.status])).toEqual([
      ["Commit logs", "approved"],
      ["Consumer groups", "pending"],
    ]);
    expect(ai.proposalRequests.map((r) => r.text)).toEqual([CHAPTER_1, CHAPTER_3]);
  });

  it("refuses chapters whose Topics were already proposed, and an empty selection", async () => {
    const { core, added } = await uploadedBook();
    await core.runJobs();
    const [, logs] = await core.sourceChapters(added.id);
    await core.selectChapters({ sourceId: added.id, chapterIds: [logs!.id] });
    await core.runJobs();

    await expect(core.selectChapters({ sourceId: added.id, chapterIds: [logs!.id] })).rejects.toThrow(ValidationError);
    await expect(core.selectChapters({ sourceId: added.id, chapterIds: [] })).rejects.toThrow(ValidationError);
  });

  it("refuses to select chapters before the PDF has been read", async () => {
    const { core, added } = await uploadedBook();
    await expect(core.selectChapters({ sourceId: added.id, chapterIds: ["anything"] })).rejects.toThrow(
      "This PDF is still being read. Select chapters once it is ready.",
    );
  });

  it("a chapter whose proposal fails shows why and can be selected again", async () => {
    const { core, ai, added } = await uploadedBook();
    ai.scriptTopicProposalFailure(CHAPTER_3, "The AI service is busy or out of credit. Try again later.");
    ai.scriptTopicProposals(CHAPTER_3, [{ name: "Consumer groups", description: "Sharing partitions." }]);
    await core.runJobs();
    const chapters = await core.sourceChapters(added.id);
    await core.selectChapters({ sourceId: added.id, chapterIds: [chapters[3]!.id] });
    await core.runJobs();

    expect((await core.sourceChapters(added.id))[3]).toMatchObject({
      status: "failed",
      failureReason: "The AI service is busy or out of credit. Try again later.",
    });
    expect((await core.source(added.id)).status).toBe("ready");

    await core.selectChapters({ sourceId: added.id, chapterIds: [chapters[3]!.id] });
    await core.runJobs();

    expect((await core.sourceChapters(added.id))[3]).toMatchObject({ status: "proposed", failureReason: null });
    expect((await core.topicProposals(added.id)).map((p) => p.name)).toEqual(["Consumer groups"]);
  });

  it("a Note has no chapters to select", async () => {
    const { core } = await createTestCore();
    const note = await core.addSource({ kind: "note", text: "Just a thought." });
    expect(await core.sourceChapters(note.id)).toEqual([]);
    await expect(core.selectChapters({ sourceId: note.id, chapterIds: ["x"] })).rejects.toThrow(
      "Only a PDF has chapters to select.",
    );
  });
});

describe("citing a PDF", () => {
  it("an Explainer's citations of a PDF carry the page of the passage", async () => {
    const { core, ai, added } = await uploadedBook();
    const CHAPTER_2 = "Chapter 2: Partitions\nA topic is split into partitions.\n\nPartitions let consumers share the work.";
    ai.scriptTopicProposals(CHAPTER_2, [{ name: "Partitions", description: "Splitting a topic." }]);
    await core.runJobs();
    const chapters = await core.sourceChapters(added.id);
    await core.selectChapters({ sourceId: added.id, chapterIds: [chapters[2]!.id] });
    await core.runJobs();
    const [proposal] = await core.topicProposals(added.id);
    const topic = await core.approveTopic({ proposalId: proposal!.id });
    await core.runJobs();

    const passages = Object.values((await core.explainer(topic.id))!.passages);
    expect(passages.length).toBeGreaterThan(0);
    for (const passage of passages) {
      expect(passage.status).toBe("available");
      if (passage.status !== "available") continue;
      const chunk = (await core.sourceChunks(added.id)).find((c) => c.id === passage.chunkId)!;
      expect(passage.anchor.page).toBe(chunk.anchor.page);
      expect(BOOK.pages[passage.anchor.page! - 1]).toContain(passage.text.split("\n")[0]);
    }
  });
});

describe("refusing a PDF", () => {
  it.each([
    ["a file that isn't .pdf", { name: "book.txt", bytes: bytes("%PDF-1.4 x") }],
    ["a .pdf that isn't a PDF", { name: "book.pdf", bytes: bytes("just text") }],
    ["an empty file", { name: "book.pdf", bytes: new Uint8Array() }],
  ])("refuses %s and keeps nothing", async (_case, file) => {
    const { core, fileStore } = await createTestCore();
    await expect(core.addSource({ kind: "pdf", file })).rejects.toThrow(ValidationError);
    expect((await core.library()).sources).toEqual([]);
    expect(fileStore.storedFiles()).toEqual([]);
  });

  it("fails with the extractor's reason when the PDF can't be read", async () => {
    const { core, contentFetcher } = await createTestCore();
    const reason = "This PDF is password-protected. Remove the password and upload it again.";
    contentFetcher.scriptPdfFailure("%PDF-1.4 locked", reason);
    const added = await core.addSource({ kind: "pdf", file: { name: "locked.pdf", bytes: bytes("%PDF-1.4 locked") } });
    await core.runJobs();
    expect(await core.source(added.id)).toMatchObject({ status: "failed", failureReason: reason });
  });
});

describe("a large PDF uploaded straight to the file store", () => {
  it("is added from its store key, like any other PDF", async () => {
    const { core, contentFetcher, fileStore } = await createTestCore();
    contentFetcher.scriptPdf(BOOK_BYTES, BOOK);
    const key = await fileStore.put("streams.pdf", bytes(BOOK_BYTES), "application/pdf");

    const added = await core.addSource({ kind: "pdf", storedFile: { key, name: "streams.pdf" } });
    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({ status: "ready", reference: "streams.pdf" });
    expect(await core.sourceChapters(added.id)).toHaveLength(4);
    expect(fileStore.storedFiles()).toHaveLength(1);
  });

  it("removes a stored file that isn't a PDF", async () => {
    const { core, fileStore } = await createTestCore();
    const key = await fileStore.put("fake.pdf", bytes("not a pdf"), "application/pdf");

    await expect(core.addSource({ kind: "pdf", storedFile: { key, name: "fake.pdf" } })).rejects.toThrow(
      "That file isn't a PDF.",
    );
    expect(fileStore.storedFiles()).toEqual([]);
    expect((await core.library()).sources).toEqual([]);
  });

  it("refuses a store key with nothing behind it", async () => {
    const { core } = await createTestCore();
    const upload = { key: "fake/9/missing.pdf", name: "missing.pdf" };
    await expect(core.addSource({ kind: "pdf", storedFile: upload })).rejects.toThrow(ValidationError);
  });
});
