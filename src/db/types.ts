import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Driver-agnostic database handle. Production passes a node-postgres (Neon) Drizzle
 * instance; tests pass a PGlite one. The core only ever sees this type.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything queries can run against: the database or an open transaction. */
export type DbOrTx = Db | Tx;
