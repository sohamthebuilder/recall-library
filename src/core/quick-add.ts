import type { CoreDeps } from "./core";
import { ValidationError } from "./errors";
import { findLink } from "./links";
import { addSource, type Source } from "./sources";
import { isYouTubeUrl } from "./youtube";

export interface AddLinkInput {
  /** What the learner pasted or shared: a link, or text with a link in it. */
  text: string;
}

/**
 * Quick add: add a pasted or shared link as a Source of the right kind. A YouTube video
 * link goes to the YouTube flow; any other web link to the blog URL flow.
 */
export async function addLink(deps: CoreDeps, input: AddLinkInput): Promise<Source> {
  const url = findLink(input.text);
  if (!url) throw new ValidationError("Paste or share a link to a blog post or YouTube video.");
  if (isYouTubeUrl(url)) return addSource(deps, { kind: "youtube", url });
  return addSource(deps, { kind: "url", url });
}
