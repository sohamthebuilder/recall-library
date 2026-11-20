import { getCore } from "@/server/core";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Safety net for background jobs: drains whatever `after()` did not finish (e.g. the
 * function was stopped). Called by Vercel Cron, which sends `Authorization: Bearer
 * $CRON_SECRET`. Refused when CRON_SECRET is not set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await getCore().runJobs({ maxJobs: 50 });
  return Response.json(result);
}
