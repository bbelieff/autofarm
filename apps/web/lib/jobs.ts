import "server-only";
import { createJobs, type Jobs } from "@autofarm/jobs";
import { db } from "./db";
import { env } from "./env";

const g = globalThis as unknown as { __afJobs?: Promise<Jobs> };
export function jobs(): Promise<Jobs> {
  if (!g.__afJobs) {
    const j = createJobs(db(), env.databaseUrl());
    g.__afJobs = j.start().then(() => j);
  }
  return g.__afJobs;
}
