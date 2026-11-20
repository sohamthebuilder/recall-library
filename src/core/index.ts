// Public surface of the application core. The UI imports from here only.
export { createCore, type Core, type CoreDeps } from "./core";
export { canSignIn } from "./access";
export { ValidationError } from "./errors";
export type { AddSourceInput, Library, Source, SourceKind } from "./sources";
export type { AiAdapter } from "./ports/ai";
export type { ContentFetcher, FetchedArticle } from "./ports/content-fetcher";
export { ContentFetchError } from "./ports/content-fetcher";
export type { FileStore, StoredFile } from "./ports/file-store";
export type { Clock } from "./ports/clock";
export { systemClock } from "./ports/clock";
