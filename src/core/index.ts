// Public surface of the application core. The UI imports from here only.
export { createCore, type Core, type CoreDeps } from "./core";
export { canSignIn } from "./access";
export { NotFoundError, ValidationError } from "./errors";
export type { AddSourceInput, Library, Source, SourceKind, SourceStatus } from "./sources";
export type { ChunkAnchor } from "./chunking";
export type { SourceChunk } from "./chunks";
export type { TopicDetail, TopicProposal, TopicProposalStatus, TopicSummary } from "./topics";
export type { FindTopicsInput, Tag, TaggedTopicSummary, TagSummary } from "./tags";
export type {
  CitedPassage,
  Explainer,
  ExplainerStatus,
  ExplainerVersion,
  ExplainerVersionCause,
  ExplainerVersionSummary,
} from "./explainers";
export type {
  ExplainerCitation,
  ExplainerContent,
  ExplainerDiagram,
  ExplainerDraft,
  ExplainerForm,
  ExplainerKeyPoint,
  ExplainerStep,
} from "./explainer-content";
export type { ImportTopicsResult } from "./topic-import";
export type { RunJobsOptions, RunJobsResult } from "./jobs";
export type { AiAdapter, ExplainerPassage, GenerateExplainerInput, TopicCandidate } from "./ports/ai";
export { AiError } from "./ports/ai";
export type { ContentFetcher, ExtractedPdf, FetchedArticle, PdfOutlineEntry } from "./ports/content-fetcher";
export { ContentFetchError } from "./ports/content-fetcher";
export type { FileStore, StoredFile } from "./ports/file-store";
export type { Clock } from "./ports/clock";
export { systemClock } from "./ports/clock";
export { isSourceProcessing } from "./source-status";
export { sourceDisplayName, sourceKindLabel } from "./source-display";
export type { StoredUpload, UploadedFile } from "./uploads";
export type { Chapter, ChapterStatus } from "./pdf-sources";
export { citationUrl } from "./citations";
export { isYouTubeUrl, parseYouTubeVideoId, youTubeWatchUrl } from "./youtube";
export type { TranscriptCue, YouTubeTranscript } from "./ports/content-fetcher";
