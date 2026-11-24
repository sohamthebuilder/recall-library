import { Fragment, type ReactNode } from "react";

/**
 * A Note's (or .md file's) markdown as formatted text: headings, lists, quotes, code blocks,
 * paragraphs, and inline bold, italic, code and http(s) links. Builds React elements only,
 * never raw HTML, so nothing in a Source can inject markup.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="markdown">{blocks(text)}</div>;
}

/** The text with markdown syntax removed, for one-line previews on cards. */
export function plainText(text: string): string {
  return text
    .replace(/^```.*$/gm, "")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|`)/g, "")
    .trim();
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => out.length;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      i++;
      out.push(
        <pre key={key()}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // Note headings sit under the page's own headings.
      const level = Math.min(heading[1]!.length + 2, 6);
      const Tag = `h${level}` as "h3" | "h4" | "h5" | "h6";
      out.push(<Tag key={key()}>{inline(heading[2]!)}</Tag>);
      i++;
      continue;
    }
    const list = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]!);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key()}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(<blockquote key={key()}>{blocks(quote.join("\n"))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(<p key={key()}>{inline(para.join(" "))}</p>);
  }
  return out;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") || part.startsWith("__")) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("*")) return <em key={i}>{inline(part.slice(1, -1))}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)!;
    return /^https?:\/\//.test(link[2]!) ? (
      <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">
        {link[1]}
      </a>
    ) : (
      <Fragment key={i}>{link[1]}</Fragment>
    );
  });
}
