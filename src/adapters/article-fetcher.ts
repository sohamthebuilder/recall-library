import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { ContentFetchError, type ContentFetcher, type FetchedArticle } from "@/core/ports/content-fetcher";

export interface ArticleFetcherOptions {
  /** Injected so tests serve saved pages instead of touching the network. */
  fetch?: typeof fetch;
  /** Give up on a page after this long. */
  timeoutMs?: number;
}

/** Below this many characters of readable text, the page is treated as having no article. */
const MIN_ARTICLE_CHARS = 100;

/** Elements whose text becomes its own block (paragraph) in the captured text. */
const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "PRE", "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "TR",
  "DIV", "SECTION", "ARTICLE", "UL", "OL", "DL", "TABLE", "FIGURE", "HEADER", "FOOTER", "ASIDE",
]);

/**
 * The real article fetcher: downloads a page and extracts its readable text with Mozilla
 * Readability (the engine behind Firefox Reader View), keeping paragraphs apart.
 */
export function createArticleFetcher(options: ArticleFetcherOptions = {}): Pick<ContentFetcher, "fetchArticle"> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  return {
    async fetchArticle(url: string): Promise<FetchedArticle> {
      const html = await download(doFetch, url, timeoutMs);
      return extractArticle(html, url);
    },
  };
}

async function download(doFetch: typeof fetch, url: string, timeoutMs: number): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await doFetch(url, {
      signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "Mozilla/5.0 (compatible; recall-library article reader)",
      },
    });
  } catch {
    if (signal.aborted) throw new ContentFetchError("The page took too long to load. Try again later.");
    throw new ContentFetchError("The site could not be reached. Check the link and try again.");
  }
  if (!response.ok) {
    throw new ContentFetchError(`The page could not be loaded (HTTP ${response.status}). Check the link and try again.`);
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType && contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    throw new ContentFetchError(`This link is not a web page (${contentType}).`);
  }
  try {
    return await response.text();
  } catch {
    if (signal.aborted) throw new ContentFetchError("The page took too long to load. Try again later.");
    throw new ContentFetchError("The site could not be reached. Check the link and try again.");
  }
}

/** Extract the readable article from a page's HTML. Exported for checks against saved pages. */
export function extractArticle(html: string, url: string): FetchedArticle {
  const { document } = parseHTML(html);
  // Readability resolves relative links against the document's URL.
  try {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.prepend(base);
  } catch {
    // A page without a head still extracts; links just stay relative.
  }
  // Site chrome Readability sometimes keeps (e.g. previous/next post links).
  for (const el of Array.from(document.querySelectorAll("nav, aside, form, [role=navigation], [role=dialog]"))) {
    el.remove();
  }
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed?.content) throw new ContentFetchError("No article text could be found on this page.");

  const { document: content } = parseHTML(`<!doctype html><html><body>${parsed.content}</body></html>`);
  const text = blocksOf(content.body as unknown as Element).join("\n\n");
  if (text.length < MIN_ARTICLE_CHARS) throw new ContentFetchError("No article text could be found on this page.");

  const title = parsed.title?.trim() || null;
  return { title, text };
}

/** The text of an element as a list of blocks: one per paragraph, heading, list item… */
function blocksOf(root: Element): string[] {
  const blocks: string[] = [];
  let inline = "";
  const flush = () => {
    const block = inline.replace(/\s+/g, " ").trim();
    if (block) blocks.push(block);
    inline = "";
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        inline += child.textContent ?? "";
      } else if (child.nodeType === 1) {
        const el = child as Element;
        if (el.tagName === "BR") {
          inline += " ";
        } else if (el.tagName === "PRE") {
          flush();
          const code = (el.textContent ?? "").replace(/^\n+|\s+$/g, "");
          if (code) blocks.push(code);
        } else if (BLOCK_TAGS.has(el.tagName)) {
          flush();
          walk(el);
          flush();
        } else {
          walk(el);
        }
      }
    }
  };
  walk(root);
  flush();
  return blocks;
}
