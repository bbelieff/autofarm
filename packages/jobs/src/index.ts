import { and, eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { schema, type Db, type JobStatus } from "@autofarm/db";

export type JobType = "connection.health" | "secrets.purge" | "ai.test" | "ai.login" | "ai.verify" | "ai.logout" | "noop";

type TypeSpec = { retryLimit: number; expireInSeconds: number };
export const JOB_SPECS: Record<JobType, TypeSpec> = {
  "connection.health": { retryLimit: 1, expireInSeconds: 120 },
  "secrets.purge": { retryLimit: 1, expireInSeconds: 120 },
  "ai.test": { retryLimit: 0, expireInSeconds: 300 },
  // 사용자가 브라우저에서 승인할 때까지 기다린다(최대 15분)
  "ai.login": { retryLimit: 0, expireInSeconds: 1000 },
  "ai.verify": { retryLimit: 0, expireInSeconds: 300 },
  "ai.logout": { retryLimit: 0, expireInSeconds: 120 },
  noop: { retryLimit: 2, expireInSeconds: 30 },
};
const DEAD = "dead-letter";

export interface JobContext {
  runId: string;
  workspaceId: string;
  input: Record<string, unknown>;
  attempt: number;
  progress(p: number, message?: string): Promise<void>;
  /** 끝나기 전에 화면에 보여줄 중간 결과(예: 로그인 링크·코드) */
  report(output: Record<string, unknown>): Promise<void>;
}
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

export function createJobs(db: Db, connectionString: string, opts: { pollingIntervalSeconds?: number; retryDelaySeconds?: number } = {}) {
  const boss = new PgBoss(connectionString);
  boss.on("error", (e: unknown) => console.error("[jobs]", e instanceof Error ? e.message : e));
  const setRun = (id: string, patch: Partial<typeof schema.jobRuns.$inferInsert>) =>
    db.update(schema.jobRuns).set({ ...patch, updatedAt: new Date() }).where(eq(schema.jobRuns.id, id));

  return {
    boss,
    async start() {
      await boss.start();
      await boss.createQueue(DEAD);
      for (const [name, spec] of Object.entries(JOB_SPECS)) {
        await boss.createQueue(name, {
          retryLimit: spec.retryLimit,
          retryDelay: opts.retryDelaySeconds ?? 30,
          expireInSeconds: spec.expireInSeconds,
          deadLetter: DEAD,
        });
      }
    },
    stop: () => boss.stop({ graceful: true, timeout: 10_000 }),

    /** 멱등 등록: 같은 (워크스페이스, 키)는 한 번만 실행된다. */
    async enqueue(input: { workspaceId: string; type: JobType; key: string; input?: Record<string, unknown> }) {
      const inserted = await db
        .insert(schema.jobRuns)
        .values({ workspaceId: input.workspaceId, type: input.type, idempotencyKey: input.key, input: input.input ?? {} })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) {
        const [existing] = await db
          .select()
          .from(schema.jobRuns)
          .where(and(eq(schema.jobRuns.workspaceId, input.workspaceId), eq(schema.jobRuns.idempotencyKey, input.key)));
        return { run: existing!, created: false };
      }
      await boss.send(input.type, { runId: inserted[0].id });
      return { run: inserted[0], created: true };
    },

    async work(type: JobType, handler: JobHandler) {
      const spec = JOB_SPECS[type];
      await boss.work<{ runId: string }>(type, { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2, batchSize: 1 }, async (jobs) => {
        for (const job of jobs) {
          const [run] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.id, job.data.runId));
          if (!run || run.status === "succeeded") continue;
          const attempt = run.attempts + 1;
          await setRun(run.id, { status: "running", attempts: attempt, message: null });
          try {
            const output = await handler({
              runId: run.id,
              workspaceId: run.workspaceId,
              input: run.input,
              attempt,
              progress: (p, message) => setRun(run.id, { progress: p, message: message ?? null }).then(() => {}),
              report: (output) => setRun(run.id, { output }).then(() => {}),
            });
            await setRun(run.id, { status: "succeeded", progress: 1, output: output ?? {} });
          } catch (e) {
            const final = attempt > spec.retryLimit;
            const status: JobStatus = final ? "dead" : "failed";
            await setRun(run.id, { status, message: e instanceof Error ? e.message.slice(0, 500) : "실패" });
            throw e;
          }
        }
      });
    },

    async listRuns(workspaceId: string, limit = 50) {
      return db
        .select()
        .from(schema.jobRuns)
        .where(eq(schema.jobRuns.workspaceId, workspaceId))
        .orderBy(sql`${schema.jobRuns.createdAt} desc`)
        .limit(limit);
    },
  };
}
export type Jobs = ReturnType<typeof createJobs>;
