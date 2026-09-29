try {
  process.loadEnvFile("../../.env");
} catch {
  // .env 없으면 환경변수만 사용
}
// 초대 방식 계정 생성(공개 가입 없음).
// 사용: pnpm --filter @autofarm/db user:add --email a@b.c --name 이름 --workspace 워크스페이스명 [--admin] [--tax simple]
// 비밀번호는 환경변수 NEW_USER_PASSWORD 로 넘긴다(명령 기록에 남지 않게).
import { parseArgs } from "node:util";
import { hashPassword } from "@autofarm/auth";
import { createDb } from "../src/client";
import { createUserWithWorkspace } from "../src/repos/workspaces";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, workspace: { type: "string" }, admin: { type: "boolean" }, tax: { type: "string" } },
});
const url = process.env.DATABASE_URL;
const pw = process.env.NEW_USER_PASSWORD;
if (!url || !pw || !values.email || !values.name || !values.workspace) {
  throw new Error("DATABASE_URL, NEW_USER_PASSWORD, --email, --name, --workspace 가 필요합니다");
}
const { db, close } = createDb(url, { max: 1 });
const { user, workspace } = await createUserWithWorkspace(db, {
  email: values.email,
  name: values.name,
  passwordHash: await hashPassword(pw),
  isAdmin: values.admin ?? false,
  workspaceName: values.workspace,
  taxType: values.tax === "simple" ? "simple" : "general",
});
console.warn(`만들었습니다: ${user.email} (관리자=${user.isAdmin}) · 워크스페이스 ${workspace.name}`);
await close();
