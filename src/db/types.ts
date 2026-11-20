import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Driver-agnostic database handle. Production passes a node-postgres (Neon) Drizzle
 * instance; tests pass a PGlite one. The core only ever sees this type.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
