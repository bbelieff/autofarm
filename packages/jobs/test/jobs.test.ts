import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createUserWithWorkspace, schema } from "@autofarm/db";
import { startTestDb } from "@autofarm/db/testing";
import { createJobs, type Jobs } from "../src";

let t: Awaited<ReturnType<typeof startTestDb>>;
let jobs: Jobs;
let ws: string;

const waitFor = async (fn: () => Promise<boolean>, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout");
};
const statusOf = async (id: string) => (await t.db.select().from(schema.jobRuns).where(eq(schema.jobRuns.id, id)))[0]!;

beforeAll(async () => {
  t = await startTestDb();
  ws = (await createUserWithWorkspace(t.db, { email: "j@x.test", name: "J", passwordHash: "x", workspaceName: "J" })).workspace.id;
  jobs = createJobs(t.db, t.url, { pollingIntervalSeconds: 0.5, retryDelaySeconds: 0 });
  await jobs.start();
});
afterAll(async () => {
  await jobs?.stop();
  await t?.stop();
});

describe("작업 큐", () => {
  it("같은 멱등 키는 한 번만 등록·실행된다", async () => {
    let calls = 0;
    await jobs.work("noop", async (ctx) => {
      if (ctx.input.fail) throw new Error("일부러 실패");
      calls++;
      await ctx.progress(0.5, "절반");
      return { ok: true };
    });
    const a = await jobs.enqueue({ workspaceId: ws, type: "noop", key: "run-1:step-a" });
    const b = await jobs.enqueue({ workspaceId: ws, type: "noop", key: "run-1:step-a" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.run.id).toBe(a.run.id);
    await waitFor(async () => (await statusOf(a.run.id)).status === "succeeded");
    expect(calls).toBe(1);
    expect((await statusOf(a.run.id)).output).toEqual({ ok: true });
  });

  it("재시도 한도를 넘으면 dead 로 남는다", async () => {
    const r = await jobs.enqueue({ workspaceId: ws, type: "noop", key: "run-2", input: { fail: true } });
    await waitFor(async () => (await statusOf(r.run.id)).status === "dead", 60_000);
    const s = await statusOf(r.run.id);
    expect(s.attempts).toBe(3);
    expect(s.message).toContain("일부러 실패");
  });
});
