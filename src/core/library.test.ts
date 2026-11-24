import { describe, expect, it } from "vitest";
import { createTestCore } from "../../test/harness";
import { ValidationError } from "./errors";

describe("adding a Note", () => {
  it("shows the Note in the Library with its title, text and the date added", async () => {
    const { core } = await createTestCore({ now: new Date("2026-03-14T09:30:00Z") });

    await core.addSource({
      kind: "note",
      title: "Kafka rebalancing",
      text: "A colleague said consumer groups rebalance when a member leaves.",
    });

    const library = await core.library();
    expect(library.sources).toEqual([
      expect.objectContaining({
        kind: "note",
        title: "Kafka rebalancing",
        text: "A colleague said consumer groups rebalance when a member leaves.",
        addedAt: new Date("2026-03-14T09:30:00Z"),
      }),
    ]);
  });

  it("refuses a Note with no text and leaves the Library unchanged", async () => {
    const { core } = await createTestCore();

    await expect(core.addSource({ kind: "note", title: "Empty", text: "   \n " })).rejects.toThrow(
      ValidationError,
    );

    expect((await core.library()).sources).toEqual([]);
  });

  it("treats a blank title as no title and trims the text", async () => {
    const { core } = await createTestCore();

    await core.addSource({ kind: "note", title: "  ", text: "  Idempotency keys make retries safe.\n" });

    const [note] = (await core.library()).sources;
    expect(note).toMatchObject({ title: null, text: "Idempotency keys make retries safe." });
  });
});

describe("the Library", () => {
  it("lists Sources newest first", async () => {
    const { core, clock } = await createTestCore();

    clock.set(new Date("2026-03-01T10:00:00Z"));
    await core.addSource({ kind: "note", text: "first" });
    clock.set(new Date("2026-03-02T10:00:00Z"));
    await core.addSource({ kind: "note", text: "second" });

    const texts = (await core.library()).sources.map((s) => s.text);
    expect(texts).toEqual(["second", "first"]);
  });
});
