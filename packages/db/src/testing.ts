import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { createDb } from "./client";
import { runMigrations } from "./migrate";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

/** 테스트용 임시 Postgres(실제 PG 바이너리) — 마이그레이션까지 적용해 돌려준다. */
export async function startTestDb() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "autofarm-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "test", password: "test", port, persistent: true, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("test");
  const url = `postgres://test:test@127.0.0.1:${port}/test`;
  const { db, close } = createDb(url, { max: 3 });
  await runMigrations(db);
  return {
    url,
    db,
    async stop() {
      await close();
      await pg.stop();
      // Windows 는 PG 종료 직후 파일 잠금이 남아 있을 수 있어 재시도하고, 끝내 실패하면 임시 폴더로 남긴다
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
    },
  };
}
