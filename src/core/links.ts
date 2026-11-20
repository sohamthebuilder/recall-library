/**
 * Picking a link out of pasted or shared text. Client-safe (no server imports), so the share
 * page can show the link it found before the learner adds it.
 */

const HTTP_URL = /https?:\/\/[^\s<>"]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?'"\]]+$/;

/**
 * The link in some text: the first http(s) URL in it, without the punctuation that
 * ends a sentence or closes a bracket around it. Text that is a single word with no
 * scheme ("blog.example.com/post") is taken as an https link. Null if there is none.
 */
export function findLink(text: string): string | null {
  const match = HTTP_URL.exec(text);
  if (match) return trimLink(match[0]);
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function trimLink(link: string): string {
  let result = link;
  for (;;) {
    const before = result;
    result = result.replace(TRAILING_PUNCTUATION, "");
    // A closing bracket belongs to the link only if the link opened one, as Wikipedia links do.
    if (result.endsWith(")") && count(result, "(") < count(result, ")")) result = result.slice(0, -1);
    if (result === before) return result;
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}
