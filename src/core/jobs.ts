import { and, asc, eq, gte, lt, or, sql } from "drizzle-orm";
import { jobs } from "@/db/schema";
import type { DbOrTx } from "@/db/types";
import type { CoreDeps } from "./core";

/**
 * Background jobs: slow work (fetching, extraction, Topic proposal, Explainer generation)
 * runs outside the web request that asked for it.
 *
 * Jobs are rows in a durable queue. Core operations enqueue them (inside their own
 * transaction, so a job exists exactly when the change that needs it does); `runJobs`
 * drains the queue. In production the UI calls `runJobs` after the response is sent
 * (Next.js `after()`), and a cron route drains anything left over. Tests call
 * `core.runJobs()` directly.
 *
 * To add a job kind: add its payload to JobPayloads, then its handler in job-handlers.ts.
 */
export interface JobPayloads {
  process_source: { sourceId: string };
  generate_explainer: { topicId: string };
  update_recall_prompts: { topicId: string };
  propose_chapter_topics: { sourceId: string };
  suggest_edits: { topicId: string; sourceId: string };
}

export type JobKind = keyof JobPayloads;

export type JobHandlers = {
  [K in JobKind]: (deps: CoreDeps, payload: JobPayloads[K]) => Promise<void>;
};

/** A job left `running` this long is assumed to have died with its process and is run again. */
const STALE_RUNNING_JOB_MS = 15 * 60 * 1000;

/**
 * A job is started at most this many times. One that died with its process this often (e.g. it
 * always outruns the serverless time limit) is given up: marked failed, and its kind's give-up
 * handler tells the learner through domain state.
 */
export const MAX_JOB_ATTEMPTS = 3;

/** What to do, per job kind, when a job is given up after MAX_JOB_ATTEMPTS. */
export type JobGiveUpHandlers = {
  [K in JobKind]?: (deps: CoreDeps, payload: JobPayloads[K]) => Promise<void>;
};

export async function enqueueJob<K extends JobKind>(
  db: DbOrTx,
  now: Date,
  kind: K,
  payload: JobPayloads[K],
): Promise<void> {
  await db.insert(jobs).values({ kind, payload, createdAt: now });
}

export interface RunJobsOptions {
  /** Stop after this many jobs (default: until the queue is empty). */
  maxJobs?: number;
}

export interface RunJobsResult {
  ran: number;
  failed: number;
}

/**
 * Run queued jobs one at a time, oldest first, including jobs enqueued by the jobs
 * themselves, until the queue is empty or `maxJobs` is reached. A handler that throws
 * marks its job failed (with the error kept for debugging) and the runner moves on;
 * handlers report learner-visible failures through their own domain state (e.g. a
 * Source's `failed` status), not by throwing.
 */
export async function runJobs(
  deps: CoreDeps,
  handlers: JobHandlers,
  options: RunJobsOptions = {},
  giveUpHandlers: JobGiveUpHandlers = {},
): Promise<RunJobsResult> {
  const result: RunJobsResult = { ran: 0, failed: 0 };
  await giveUpDeadJobs(deps, giveUpHandlers);
  while (options.maxJobs === undefined || result.ran < options.maxJobs) {
    const job = await claimNextJob(deps);
    if (!job) break;
    result.ran++;
    try {
      const handler = handlers[job.kind as JobKind] as (deps: CoreDeps, payload: unknown) => Promise<void>;
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(deps, job.payload);
      await deps.db
        .update(jobs)
        .set({ status: "done", finishedAt: deps.clock.now(), lastError: null })
        .where(eq(jobs.id, job.id));
    } catch (e) {
      result.failed++;
      await deps.db
        .update(jobs)
        .set({ status: "failed", finishedAt: deps.clock.now(), lastError: errorText(e) })
        .where(eq(jobs.id, job.id));
    }
  }
  return result;
}

/** Jobs that died with their process MAX_JOB_ATTEMPTS times are failed instead of run again. */
async function giveUpDeadJobs(deps: CoreDeps, giveUpHandlers: JobGiveUpHandlers) {
  const now = deps.clock.now();
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_JOB_MS);
  const dead = await deps.db
    .update(jobs)
    .set({
      status: "failed",
      finishedAt: now,
      lastError: `Gave up: the job stopped without finishing ${MAX_JOB_ATTEMPTS} times.`,
    })
    .where(and(eq(jobs.status, "running"), lt(jobs.startedAt, staleBefore), gte(jobs.attempts, MAX_JOB_ATTEMPTS)))
    .returning({ kind: jobs.kind, payload: jobs.payload });
  for (const job of dead) {
    const handler = giveUpHandlers[job.kind as JobKind] as ((deps: CoreDeps, payload: unknown) => Promise<void>) | undefined;
    if (handler) await handler(deps, job.payload);
  }
}

async function claimNextJob(deps: CoreDeps) {
  const now = deps.clock.now();
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_JOB_MS);
  const runnable = or(
    eq(jobs.status, "queued"),
    and(eq(jobs.status, "running"), lt(jobs.startedAt, staleBefore), lt(jobs.attempts, MAX_JOB_ATTEMPTS)),
  );
  // Claim atomically so concurrent runners (after() + cron) never run the same job twice.
  const next = deps.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(runnable)
    .orderBy(asc(jobs.createdAt), asc(jobs.id))
    .limit(1)
    .for("update", { skipLocked: true });
  const [claimed] = await deps.db
    .update(jobs)
    .set({ status: "running", startedAt: now, attempts: sql`${jobs.attempts} + 1` })
    .where(and(sql`${jobs.id} = (${next})`, runnable))
    .returning();
  return claimed ?? null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
}
