import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./errors";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("uploading a .md file", () => {
  it("adds a Source named after the file, keeps the file and captures its text", async () => {
    const { core, fileStore } = await createTestCore({ now: new Date("2026-04-02T08:00:00Z") });
    const markdown = "# Consumer groups\n\nPartitions are shared between the members of a group.\n";

    const added = await core.addSource({
      kind: "markdown",
      file: { name: "kafka-notes.md", bytes: utf8(markdown) },
    });
    expect(added).toMatchObject({
      kind: "markdown",
      reference: "kafka-notes.md",
      addedAt: new Date("2026-04-02T08:00:00Z"),
      status: "pending",
    });

    await core.runJobs();

    const source = await core.source(added.id);
    expect(source).toMatchObject({
      status: "ready",
      reference: "kafka-notes.md",
      text: "# Consumer groups\n\nPartitions are shared between the members of a group.",
    });
    const stored = fileStore.storedFiles();
    expect(stored).toHaveLength(1);
    expect(new TextDecoder().decode(stored[0]!.bytes)).toBe(markdown);
    expect(stored[0]!.contentType).toBe("text/markdown");
  });

  it.each([
    ["a file that isn't .md", { name: "notes.txt", bytes: utf8("hello") }],
    ["an empty file", { name: "empty.md", bytes: new Uint8Array() }],
    ["a file that isn't UTF-8 text", { name: "binary.md", bytes: new Uint8Array([0xff, 0xfe, 0xfd]) }],
  ])("refuses %s and keeps nothing", async (_case, file) => {
    const { core, fileStore } = await createTestCore();

    await expect(core.addSource({ kind: "markdown", file })).rejects.toThrow(ValidationError);

    expect((await core.library()).sources).toEqual([]);
    expect(fileStore.storedFiles()).toEqual([]);
  });

  it("fails the Source with a reason if its file is no longer in the file store", async () => {
    const { core, fileStore } = await createTestCore();
    const added = await core.addSource({ kind: "markdown", file: { name: "gone.md", bytes: utf8("# Gone") } });
    await fileStore.delete(fileStore.storedFiles()[0]!.key);

    await core.runJobs();

    expect(await core.source(added.id)).toMatchObject({
      status: "failed",
      failureReason: "The uploaded file could not be found. Upload it again.",
    });
  });

  it("captures Windows line endings as plain newlines", async () => {
    const { core } = await createTestCore();
    const added = await core.addSource({
      kind: "markdown",
      file: { name: "win.MD", bytes: utf8("﻿Line one\r\nLine two\r\n") },
    });

    await core.runJobs();

    expect((await core.source(added.id)).text).toBe("Line one\nLine two");
  });
});
