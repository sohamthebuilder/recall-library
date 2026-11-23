import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Issues the browser a short-lived token to upload a PDF straight to Vercel Blob (client
 * upload). Books are larger than the 4.5 MB request body a Vercel function accepts, so the
 * bytes never pass through the app; the form then calls the `addUploadedPdf` action with the
 * blob's pathname, and the core checks the file. Signed-in learner only.
 */
const MAX_PDF_BYTES = 100 * 1024 * 1024; // Same limit as the core's pdfUpload rule.

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await auth();
        if (!session?.user) throw new Error("Sign in to upload.");
        if (!pathname.startsWith("uploads/") || !pathname.toLowerCase().endsWith(".pdf")) {
          throw new Error("Only a PDF can be uploaded here.");
        }
        return { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: MAX_PDF_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 400 });
  }
}
