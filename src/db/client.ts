import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

let db: Db | undefined;

/** Production database (Neon over node-postgres). Created on first use, not at import/build time. */
export function getDb(): Db {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    db = drizzle({ client: new Pool({ connectionString, max: 5 }), schema });
  }
  return db;
}
