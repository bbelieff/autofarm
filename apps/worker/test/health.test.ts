import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectionsRepo, createUserWithWorkspace } from "@autofarm/db";
import { startTestDb } from "@autofarm/db/testing";
import { createVault, generateMasterKey } from "@autofarm/vault";
import { checkNaverSearchad } from "../src/health";
import { healthHandler } from "../src/handlers";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("네이버 검색광고 점검", () => {
  it("서명 헤더를 규격대로 만든다", async () => {
    let seen: Headers | null = null;
    const fake = (async (_u: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return json({ keywordList: [{ relKeyword: "사과" }] });
    }) as typeof fetch;
    const r = await checkNaverSearchad({ customer_id: "123", access_license: "lic", secret_key: "sec" }, fake, 1700000000000);
    expect(r.status).toBe("ok");
    const expected = createHmac("sha256", "sec").update("1700000000000.GET./keywordstool").digest("base64");
    expect(seen!.get("X-Signature")).toBe(expected);
    expect(seen!.get("X-Customer")).toBe("123");
  });
});

describe("점검 작업", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  const vault = createVault({ masterKey: generateMasterKey() });
  let ws: string;
  beforeAll(async () => {
    t = await startTestDb();
    ws = (await createUserWithWorkspace(t.db, { email: "w@x.test", name: "W", passwordHash: "x", workspaceName: "W" })).workspace.id;
  });
  afterAll(async () => t?.stop());

  const make = async () =>
    connectionsRepo(t.db, ws).create({
      kind: "data:naver-searchad",
      label: "검색광고",
      authType: "api_key",
      secret: vault.encrypt(JSON.stringify({ customer_id: "1", access_license: "a", secret_key: "s" }), `${ws}|data:naver-searchad`),
      secretHint: "••••",
    });
  const ctx = (connectionId: string) => ({ runId: "r", workspaceId: ws, input: { connectionId }, attempt: 1, progress: async () => {} });

  it("정상 응답이면 ok", async () => {
    const c = await make();
    await healthHandler(t.db, vault, (async () => json({ keywordList: [] })) as typeof fetch)(ctx(c.id));
    expect((await connectionsRepo(t.db, ws).get(c.id))?.status).toBe("ok");
  });

  it("401이면 만료", async () => {
    const c = await connectionsRepo(t.db, ws).list().then((l) => l[0]!);
    await healthHandler(t.db, vault, (async () => json({}, 401)) as typeof fetch)(ctx(c.id));
    const after = await connectionsRepo(t.db, ws).get(c.id);
    expect(after?.status).toBe("expired");
    expect(after?.statusMessage).toContain("401");
  });
});
