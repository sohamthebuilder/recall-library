import { describe, expect, it } from "vitest";
import { sourceDisplayName } from "./source-display";

const note = (text: string | null, title: string | null = null) => ({ kind: "note" as const, title, reference: null, text });

describe("the name shown for a Source", () => {
  it("is its title when it has one", () => {
    expect(sourceDisplayName(note("# Heading\nBody", "Raft notes"))).toBe("Raft notes");
  });

  it("names an untitled Note from its first heading", () => {
    expect(sourceDisplayName(note("Some intro line.\n\n## Leader election\nOne leader per term."))).toBe("Leader election");
  });

  it("names an untitled Note with no heading from its first line, without markdown, shortened", () => {
    expect(sourceDisplayName(note("\n  **Idempotency keys** make retries safe.\nMore text."))).toBe("Idempotency keys make retries safe.");
    expect(
      sourceDisplayName(note("- A colleague said consumer groups rebalance whenever a member joins or leaves the group, which pauses reading")),
    ).toBe("A colleague said consumer groups rebalance whenever a member…");
  });

  it("falls back to the file name or link, then to the kind", () => {
    expect(sourceDisplayName({ kind: "markdown", title: null, reference: "kafka.md", text: "# Kafka" })).toBe("kafka.md");
    expect(sourceDisplayName(note(null))).toBe("Untitled Note");
    expect(sourceDisplayName({ kind: "url", title: null, reference: null })).toBe("Untitled Blog post");
  });
});
