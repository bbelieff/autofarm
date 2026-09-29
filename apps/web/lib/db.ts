import "server-only";
import { createDb, type Db } from "@autofarm/db";
import { env } from "./env";

const g = globalThis as unknown as { __afDb?: Db };
export function db(): Db {
  if (!g.__afDb) g.__afDb = createDb(env.databaseUrl(), { max: 5 }).db;
  return g.__afDb;
}
