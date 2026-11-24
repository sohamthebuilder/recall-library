"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { addUploadedPdf } from "./actions";

/**
 * Pick a PDF (a book or a paper). The file goes straight from the browser to Vercel Blob,
 * because books are larger than a server request may be; then the app adds it as a Source.
 * Its chapters can be selected once it has been read.
 */
export function UploadPdfForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File) || !file.name) {
      setError("Choose a PDF to upload.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only a PDF can be uploaded here.");
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const blob = await upload(`uploads/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/uploads/pdf",
        contentType: "application/pdf",
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      const result = await addUploadedPdf({ key: blob.pathname, name: file.name });
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        if (result.sourceId) router.push(`/sources/${result.sourceId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed. Try again.");
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <label htmlFor="pdf-file">File</label>
      <input id="pdf-file" name="file" type="file" accept=".pdf,application/pdf" required />
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        You choose which chapters to turn into Topics once it has been read.
      </p>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="primary" type="submit" disabled={busy}>
        {busy ? `Uploading… ${progress}%` : "Upload"}
      </button>
    </form>
  );
}
