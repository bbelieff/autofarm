import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectionsRepo, createUserWithWorkspace, purgeExpiredSecrets } from "../src";
import { startTestDb } from "../src/testing";

let t: Awaited<ReturnType<typeof startTestDb>>;
let wsA: string;
let wsB: string;

beforeAll(async () => {
  t = await startTestDb();
  wsA = (await createUserWithWorkspace(t.db, { email: "a@x.test", name: "A", passwordHash: "x", workspaceName: "A" })).workspace.id;
  wsB = (await createUserWithWorkspace(t.db, { email: "b@x.test", name: "B", passwordHash: "x", workspaceName: "B", taxType: "simple" })).workspace.id;
});
afterAll(async () => t?.stop());

describe("워크스페이스 격리", () => {
  it("다른 워크스페이스의 연결은 조회·수정·삭제되지 않는다", async () => {
    const a = connectionsRepo(t.db, wsA);
    const b = connectionsRepo(t.db, wsB);
    const row = await a.create({ kind: "data:naver-searchad", label: "검색광고", authType: "api_key", secret: null, secretHint: "••••1234" });
    expect(await a.list()).toHaveLength(1);
    expect(await b.list()).toHaveLength(0);
    expect(await b.get(row.id)).toBeNull();
    expect(await b.setStatus(row.id, "ok", null)).toBeNull();
    expect(await b.remove(row.id)).toBe(false);
    expect((await a.get(row.id))?.status).toBe("unset");
  });

  it("보관 기간이 지난 세션 비밀은 파기되고 만료 상태가 된다", async () => {
    const a = connectionsRepo(t.db, wsA);
    const sealed = { v: 1 as const, kid: "k1", edk: "e", iv: "i", tag: "t", ct: "c" };
    const row = await a.create({
      kind: "supplier:baljuora",
      label: "웰그린",
      authType: "login",
      secret: sealed,
      secretHint: "••••abcd",
      consentPurpose: "공급가 수집",
      retainUntil: new Date(Date.now() - 1000),
    });
    expect(await purgeExpiredSecrets(t.db)).toBeGreaterThanOrEqual(1);
    const after = await a.get(row.id);
    expect(after?.secret).toBeNull();
    expect(after?.status).toBe("expired");
  });
});
