import { sources } from "@/db/schema";
import type { CoreDeps } from "./core";
import { ValidationError } from "./errors";
import { enqueueJob } from "./jobs";
import { ContentFetchError } from "./ports/content-fetcher";
import type { StoredFile } from "./ports/file-store";
import { type Source, type SourceKind, type SourceRow, toSource } from "./sources";

/** A file the learner uploaded, as the UI hands it to the core. */
export interface UploadedFile {
  /** The file's name on the learner's device, e.g. "kafka-notes.md". */
  name: string;
  bytes: Uint8Array;
}

/** What an uploadable Source kind accepts. One per kind (markdownUpload, pdfUpload). */
export interface UploadRule {
  kind: SourceKind;
  /** Lower-case extensions including the dot, e.g. [".md"]. */
  extensions: string[];
  /** Content type the file is stored with. */
  contentType: string;
  maxBytes: number;
  /** How the learner names this kind of file in messages, e.g. "a .md file". */
  label: string;
  /** Extra check on the bytes; throw ValidationError to refuse the upload. */
  validate?(bytes: Uint8Array): void;
}

/**
 * A file the browser already put in the file store itself (a large PDF goes straight to
 * Vercel Blob, past the server's request size limit): its store key and original name.
 */
export interface StoredUpload {
  key: string;
  name: string;
}

/**
 * Add an uploaded file as a Source: check it against the kind's rule, keep it in the file
 * store, then insert the Source `pending` (reference = file name) and queue its processing.
 * The kind's handler reads the file back with `readUploadedFile`.
 */
export async function addUploadedSource(
  deps: CoreDeps,
  file: UploadedFile,
  rule: UploadRule,
): Promise<Source> {
  const name = checkUpload(file.name, file.bytes, rule);
  const fileKey = await deps.fileStore.put(name, file.bytes, rule.contentType);
  return insertUploadedSource(deps, name, fileKey, rule);
}

/**
 * Add a file the browser already stored (see StoredUpload) as a Source, with the same checks
 * as `addUploadedSource`. A file that is refused is removed from the store.
 */
export async function addStoredUploadSource(
  deps: CoreDeps,
  upload: StoredUpload,
  rule: UploadRule,
): Promise<Source> {
  const stored = upload.key ? await deps.fileStore.get(upload.key) : null;
  if (!stored) throw new ValidationError(`The upload didn't arrive. Choose ${rule.label} and try again.`);
  let name: string;
  try {
    name = checkUpload(upload.name, stored.bytes, rule);
  } catch (e) {
    await deps.fileStore.delete(upload.key).catch(() => {});
    throw e;
  }
  return insertUploadedSource(deps, name, upload.key, rule);
}

/** Check a file against the kind's rule; returns its bare name. Throws ValidationError. */
function checkUpload(fileName: string, bytes: Uint8Array, rule: UploadRule): string {
  const name = baseName(fileName);
  if (!name) throw new ValidationError(`Choose ${rule.label} to upload.`);
  if (!rule.extensions.some((ext) => name.toLowerCase().endsWith(ext))) {
    throw new ValidationError(`Only ${rule.label} can be uploaded here.`);
  }
  if (bytes.byteLength === 0) throw new ValidationError(`${name} is empty.`);
  if (bytes.byteLength > rule.maxBytes) {
    throw new ValidationError(`${name} is too large (the limit is ${formatMegabytes(rule.maxBytes)}).`);
  }
  rule.validate?.(bytes);
  return name;
}

async function insertUploadedSource(deps: CoreDeps, name: string, fileKey: string, rule: UploadRule): Promise<Source> {
  const now = deps.clock.now();
  try {
    return await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sources)
        .values({ kind: rule.kind, title: null, reference: name, fileKey, text: null, addedAt: now, status: "pending" })
        .returning();
      await enqueueJob(tx, now, "process_source", { sourceId: row!.id });
      return toSource(row!);
    });
  } catch (e) {
    await deps.fileStore.delete(fileKey).catch(() => {});
    throw e;
  }
}

/** Read an uploaded Source's file back from the file store (for a kind handler's `fetch`). */
export async function readUploadedFile(deps: CoreDeps, source: SourceRow): Promise<StoredFile> {
  const file = source.fileKey ? await deps.fileStore.get(source.fileKey) : null;
  if (!file) throw new ContentFetchError("The uploaded file could not be found. Upload it again.");
  return file;
}

/** Browsers send a bare name, but strip any path a client might include. */
function baseName(name: string): string {
  return name.split(/[\\/]/).pop()!.trim();
}

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
