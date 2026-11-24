# books-rag

A personal learning app for one learner: add Sources, turn them into Topics and Explainers, and
remember them with Recall Prompts and Reviews. See `GLOSSARY.md` for the vocabulary and
`docs/adr/` for key decisions.

Stack: Next.js (App Router, TypeScript) on Vercel, Neon Postgres with pgvector, Drizzle ORM,
Auth.js (Google sign-in for a single allowed email), Vitest with PGlite for tests.

## Run the tests

```bash
npm install
npm test          # core tests against an in-process Postgres (PGlite + pgvector); no network
npm run typecheck
npm run build
```

Tests need no database server, no network and no OpenAI key. Each test gets a fresh, fully
migrated PGlite database and deterministic fake adapters (`test/harness.ts`).

## Run the app locally

1. Create a Postgres database with pgvector available (a free Neon project works; so does a local
   Postgres with the `vector` extension installed).
2. Create a Google OAuth client (Web application) with the redirect URI
   `http://localhost:3000/api/auth/callback/google`.
3. `cp .env.example .env.local` and fill in every variable. `LEARNER_EMAIL` is the only Google
   account that can sign in.
4. Apply migrations and start the dev server:

   ```bash
   DATABASE_URL=... npm run db:migrate
   npm run dev
   ```

5. Open http://localhost:3000 and sign in with Google.

## Deploy (Vercel + Neon)

1. Create a Neon project and copy its connection string.
2. Import the repo into Vercel and set `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
   `AUTH_GOOGLE_SECRET`, `LEARNER_EMAIL`, `OPENAI_API_KEY` and `CRON_SECRET` in the project's
   environment variables. In the project's Storage tab, create a Blob store and connect it;
   that sets `BLOB_READ_WRITE_TOKEN` (the file store for uploaded files). Optionally set
   `LEARNER_TIME_ZONE` (e.g. `Europe/London`) so the due queue's "today" is yours (default UTC).
3. Add `https://<your-domain>/api/auth/callback/google` as an authorised redirect URI on the
   Google OAuth client.
4. Run `DATABASE_URL=<neon url> npm run db:migrate` once (and after each schema change).
5. Deploy.

## Uploading PDFs (books)

A Vercel function accepts at most a 4.5 MB request body, so .md files go through a server
action but PDFs do not: the browser uploads the PDF straight to Vercel Blob (a *client
upload*, `@vercel/blob/client`), using a short-lived token from `/api/uploads/pdf` (signed-in
learner only, `application/pdf`, up to 100 MB). The form then calls the `addUploadedPdf`
action with the blob's pathname, and the core checks the stored file (it must really be a
PDF) before adding the Source. Locally this needs `BLOB_READ_WRITE_TOKEN` too. The PDF is
read with `unpdf` (PDF.js) in the background job; a very large book is read within one job
run, so keep `maxDuration` in mind on the Hobby plan.

After a PDF is read, its Source page lists its chapters (top-level outline entries, or
20-page ranges when it has no outline). Topics are proposed only from the chapters you
select, one AI call per chapter, and you can select more chapters later.

## Background jobs

Slow work (processing a Source, proposing Topics) runs as background jobs stored in the `jobs`
table. A server action that queues work drains the queue after its response is sent
(`after()` from `next/server`). `vercel.json` also schedules `/api/jobs/run` (protected by
`CRON_SECRET`) once a day as a safety net; on a paid Vercel plan you can make it more frequent.

## Layout

```
src/core/          application core: operations named after the glossary (the only test seam)
src/core/ports/    adapter interfaces: AI, content fetcher, file store, clock
src/adapters/      adapter implementations; fakes/ holds the deterministic test fakes
src/db/            Drizzle schema, driver-agnostic Db type, production client
src/server/core.ts composition root: the core wired to real adapters (OpenAI in src/adapters/openai.ts)
src/server/jobs.ts runJobsAfterResponse(): drain background jobs after a server action responds
src/app/           Next.js UI: thin pages and server actions that call the core
src/auth.ts        Auth.js configuration
drizzle/           SQL migrations (generated with `npm run db:generate`)
test/harness.ts    createTestCore(): core + fresh PGlite + fakes
```
