import { del, get, put } from "@vercel/blob";
import type { FileStore, StoredFile } from "@/core/ports/file-store";

/**
 * File store on Vercel Blob. Files are private (read back with the store's token, never
 * by a public URL) and kept under `uploads/<name>-<random suffix>`; the key is the blob's
 * pathname. Needs BLOB_READ_WRITE_TOKEN (set automatically when a Blob store is connected
 * to the Vercel project).
 */
export class VercelBlobFileStore implements FileStore {
  constructor(private readonly token?: string) {}

  async put(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const blob = await put(`uploads/${name}`, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: true,
      contentType,
      token: this.token,
    });
    return blob.pathname;
  }

  async get(key: string): Promise<StoredFile | null> {
    const result = await get(key, { access: "private", useCache: false, token: this.token });
    if (!result || result.statusCode !== 200) return null;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    return { key, bytes, contentType: result.blob.contentType };
  }

  async delete(key: string): Promise<void> {
    await del(key, { token: this.token });
  }
}

export function vercelBlobFromEnv(): FileStore {
  return new VercelBlobFileStore(process.env.BLOB_READ_WRITE_TOKEN || undefined);
}
