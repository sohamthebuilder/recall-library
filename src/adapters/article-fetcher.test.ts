import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ContentFetchError } from "@/core/ports/content-fetcher";
import { createArticleFetcher } from "./article-fetcher";

/** Saved sample pages; tests never touch the network. */
function samplePage(name: string): string {
  return readFileSync(new URL(`../../test/fixtures/articles/${name}`, import.meta.url), "utf8");
}

/** A stand-in for `fetch` that serves one response for any URL. */
function serving(body: string, init: { status?: number; contentType?: string } = {}): typeof fetch {
  return async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: { "content-type": init.contentType ?? "text/html; charset=utf-8" },
    });
}

const url = "https://blog.example.com/2025/09/kafka-consumer-groups";

describe("the article fetcher, on saved sample pages", () => {
  it("captures a blog post's title and readable text, without the site's chrome", async () => {
    const fetcher = createArticleFetcher({ fetch: serving(samplePage("wordpress-post.html")) });

    const article = await fetcher.fetchArticle(url);

    expect(article.title).toBe("How Kafka consumer groups share partitions");
    expect(article.text).toContain("A consumer group is a set of consumers that cooperate to read a topic.");
    expect(article.text).toContain("Offsets record progress");
    expect(article.text).toContain("Commit after processing to get at-least-once delivery.");
    expect(article.text).toContain("Partitions are the unit of parallelism in Kafka.");
    expect(article.text.trimEnd().endsWith("the coordinator keeps the two in step.")).toBe(true);
    for (const chrome of ["We use cookies", "Recent posts", "Great post, thanks!", "All rights reserved", "gtag"]) {
      expect(article.text).not.toContain(chrome);
    }
  });

  it("keeps paragraphs, headings and list items apart as separate blocks", async () => {
    const fetcher = createArticleFetcher({ fetch: serving(samplePage("wordpress-post.html")) });

    const { text } = await fetcher.fetchArticle(url);
    const blocks = text.split("\n\n");

    expect(blocks).toContain("Offsets record progress");
    expect(blocks).toContain("Commit before processing to get at-most-once delivery.");
    expect(blocks).toContain(
      "When a consumer joins or leaves, the group rebalances: the group coordinator takes the partitions back and hands them out again. During a rebalance nobody in the group makes progress, which is why long rebalances show up as consumer lag.",
    );
  });

  it("captures a newsletter-style post", async () => {
    const fetcher = createArticleFetcher({ fetch: serving(samplePage("newsletter-post.html")) });

    const article = await fetcher.fetchArticle("https://letters.example.com/p/spaced-repetition");

    expect(article.title).toBe("Spaced repetition, explained");
    expect(article.text).toContain("The forgetting curve, first measured by Ebbinghaus");
    expect(article.text).toContain("If you remembered, double the gap.");
    expect(article.text).not.toContain("Type your email");
  });

  it("fails clearly on a page with no article text", async () => {
    const fetcher = createArticleFetcher({ fetch: serving(samplePage("app-shell.html")) });

    await expect(fetcher.fetchArticle(url)).rejects.toThrow(
      new ContentFetchError("No article text could be found on this page."),
    );
  });
});

describe("the article fetcher, when the page can't be fetched", () => {
  it("reports a page that doesn't exist", async () => {
    const fetcher = createArticleFetcher({ fetch: serving("Not found", { status: 404 }) });

    await expect(fetcher.fetchArticle(url)).rejects.toThrow(
      new ContentFetchError("The page could not be loaded (HTTP 404). Check the link and try again."),
    );
  });

  it("reports a link that isn't a web page", async () => {
    const fetcher = createArticleFetcher({ fetch: serving("%PDF-1.7", { contentType: "application/pdf" }) });

    await expect(fetcher.fetchArticle(url)).rejects.toThrow(
      new ContentFetchError("This link is not a web page (application/pdf)."),
    );
  });

  it("reports a site that can't be reached", async () => {
    const fetcher = createArticleFetcher({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(fetcher.fetchArticle(url)).rejects.toThrow(
      new ContentFetchError("The site could not be reached. Check the link and try again."),
    );
  });

  it("gives up on a page that takes too long", async () => {
    const fetcher = createArticleFetcher({
      timeoutMs: 10,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    });

    await expect(fetcher.fetchArticle(url)).rejects.toThrow(
      new ContentFetchError("The page took too long to load. Try again later."),
    );
  });
});
