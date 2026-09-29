import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./client";

export const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder });
}
