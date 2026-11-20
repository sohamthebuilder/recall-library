/**
 * File store adapter: keeps uploaded files (PDF, .md).
 * Real implementation: Vercel Blob (ticket #11). Fake: src/adapters/fakes/fake-file-store.ts.
 */
export interface StoredFile {
  key: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface FileStore {
  /** Store bytes and return the key to read them back with. */
  put(name: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** Read a stored file, or null if there is none under that key. */
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}
