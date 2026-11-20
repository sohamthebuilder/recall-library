import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { FakeAi } from "@/adapters/fakes/fake-ai";
import { FakeContentFetcher } from "@/adapters/fakes/fake-content-fetcher";
import { FakeFileStore } from "@/adapters/fakes/fake-file-store";
import { createCore } from "@/core/core";
import * as schema from "@/db/schema";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export interface TestCoreOptions {
  /** Fixed "now" for the core's clock. Change it later with `clock.set`. */
  now?: Date;
}

/**
 * A core wired to a fresh, fully migrated in-process Postgres (PGlite + pgvector) and
 * deterministic fakes. Script the fakes through the returned handles.
 */
export async function createTestCore(options: TestCoreOptions = {}) {
  const pg = new PGlite({ extensions: { vector } });
  const db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });

  let now = options.now ?? new Date("2026-01-01T00:00:00Z");
  const clock = {
    now: () => now,
    set: (d: Date) => {
      now = d;
    },
  };
  const ai = new FakeAi();
  const contentFetcher = new FakeContentFetcher();
  const fileStore = new FakeFileStore();

  const core = createCore({ db, ai, contentFetcher, fileStore, clock });
  return { core, ai, contentFetcher, fileStore, clock, close: () => pg.close() };
}
