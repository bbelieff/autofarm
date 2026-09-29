// 로컬 개발용 .env 생성(없을 때만). 값은 이 PC에서만 쓰는 무작위 테스트 값이다.
// 사용: node scripts/make-local-env.mjs [claude 실행 파일 경로]
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.log(".env 가 이미 있습니다 — 건드리지 않습니다");
  process.exit(0);
}
const claudeBin = (process.argv[2] ?? "").replaceAll("\\", "/");
const lines = [
  "DATABASE_URL=postgres://autofarm:autofarm@127.0.0.1:54329/autofarm",
  `VAULT_MASTER_KEY=${randomBytes(32).toString("base64")}`,
  `SESSION_SECRET=${randomBytes(32).toString("base64")}`,
  "STORAGE_DIR=./storage",
  "# 로컬 테스트 계정: admin@autofarm.test(관리자·일반과세) / friend@autofarm.test(간이과세) — 비밀번호는 아래 값",
  `TEST_USER_PASSWORD=af-test-${randomBytes(9).toString("base64url")}`,
  claudeBin ? `CLAUDE_BIN=${claudeBin}` : "# CLAUDE_BIN=",
  "",
];
writeFileSync(".env", lines.join("\n"));
console.log(".env 를 만들었습니다");
