try {
  process.loadEnvFile("../../.env");
} catch {
  // .env 없으면 환경변수만 사용
}
import { createDb, listAllWorkspaces, schema } from "@autofarm/db";
import { createJobs } from "@autofarm/jobs";
import { createRedactingLogger, createVault } from "@autofarm/vault";
import { eq } from "drizzle-orm";
import { aiTestHandler, healthHandler, purgeHandler } from "./handlers";
import { aiLoginHandler, aiLogoutHandler, aiVerifyHandler } from "./ai-sub";
import { HEALTH_CHECKS } from "./health";

const log = createRedactingLogger(console);
const url = process.env.DATABASE_URL;
const masterKey = process.env.VAULT_MASTER_KEY;
if (!url || !masterKey) throw new Error("DATABASE_URL, VAULT_MASTER_KEY 가 필요합니다");

const { db, close } = createDb(url, { max: 3 });
const vault = createVault({ masterKey });
const jobs = createJobs(db, url);
await jobs.start();

await jobs.work("connection.health", healthHandler(db, vault));
await jobs.work("secrets.purge", purgeHandler(db));
await jobs.work("ai.test", aiTestHandler(db, vault));
await jobs.work("ai.login", aiLoginHandler(db));
await jobs.work("ai.verify", aiVerifyHandler(db, vault));
await jobs.work("ai.logout", aiLogoutHandler(db));

// 매일 04:00(KST) 유지보수: 만료 비밀 파기 + 점검 가능한 연결 전부 점검
const DAILY = "maintenance.daily";
await jobs.boss.createQueue(DAILY);
await jobs.boss.schedule(DAILY, "0 4 * * *", {}, { tz: "Asia/Seoul" });
await jobs.boss.work(DAILY, async () => {
  const day = new Date().toISOString().slice(0, 10);
  for (const ws of await listAllWorkspaces(db)) {
    await jobs.enqueue({ workspaceId: ws.id, type: "secrets.purge", key: `purge:${day}` });
    const conns = await db.select().from(schema.connections).where(eq(schema.connections.workspaceId, ws.id));
    for (const c of conns.filter((c) => HEALTH_CHECKS[c.kind])) {
      await jobs.enqueue({ workspaceId: ws.id, type: "connection.health", key: `health:${c.id}:${day}`, input: { connectionId: c.id } });
    }
  }
});

log.info("[worker] 시작");
const shutdown = async () => {
  log.info("[worker] 종료 중");
  await jobs.stop();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
