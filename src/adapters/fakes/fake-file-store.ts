import type { FileStore, StoredFile } from "@/core/ports/file-store";

/** In-memory file store. Keys are deterministic: `fake/<n>/<name>`. */
export class FakeFileStore implements FileStore {
  private readonly files = new Map<string, StoredFile>();
  private counter = 0;

  async put(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const key = `fake/${++this.counter}/${name}`;
    this.files.set(key, { key, bytes, contentType });
    return key;
  }

  async get(key: string): Promise<StoredFile | null> {
    return this.files.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  /** Every file currently kept, in the order they were stored. */
  storedFiles(): StoredFile[] {
    return [...this.files.values()];
  }
}
