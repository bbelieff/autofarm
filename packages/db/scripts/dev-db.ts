// 로컬 개발용 Postgres(설치 없이 실제 PG 바이너리). 데이터는 레포 루트 .pgdata/ 에 남는다.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = path.join(root, ".pgdata");
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "autofarm", password: "autofarm", port: 54329, persistent: true });

if (!existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("autofarm");
} catch {
  // 이미 있음
}
console.warn("Postgres 실행 중: postgres://autofarm:autofarm@127.0.0.1:54329/autofarm (Ctrl+C로 종료)");
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
