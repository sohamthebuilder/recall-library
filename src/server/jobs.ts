import "server-only";
import { after } from "next/server";
import { getCore } from "./core";

/**
 * Drain the background job queue once the current response has been sent. Call this from
 * any server action whose core operation enqueues jobs (adding or retrying a Source,
 * approving a Topic...). The cron route /api/jobs/run picks up anything left behind.
 */
export function runJobsAfterResponse(): void {
  after(async () => {
    try {
      await getCore().runJobs();
    } catch (e) {
      console.error("Background jobs failed", e);
    }
  });
}
