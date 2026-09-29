import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserWithWorkspace } from "@autofarm/db";
import { startTestDb } from "@autofarm/db/testing";
import { createSession, deleteSession, hashPassword, readSession, verifyPassword } from "../src";

describe("비밀번호", () => {
  it("해시·검증", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong password!!", h)).toBe(false);
  });
  it("짧은 비밀번호 거부", async () => {
    await expect(hashPassword("abc")).rejects.toThrow();
    await expect(hashPassword("abcd")).resolves.toMatch(/^scrypt\$/);
  });
});

describe("세션", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => t?.stop());

  it("생성·조회·만료·삭제", async () => {
    const { user, workspace } = await createUserWithWorkspace(t.db, { email: "s@x.test", name: "S", passwordHash: "x", workspaceName: "S", isAdmin: true });
    const { token } = await createSession(t.db, user.id, workspace.id);
    const s = await readSession(t.db, token);
    expect(s?.isAdmin).toBe(true);
    expect(s?.workspaceId).toBe(workspace.id);
    expect(await readSession(t.db, "nope")).toBeNull();
    expect(await readSession(t.db, token, new Date(Date.now() + 40 * 86400_000))).toBeNull();
    await deleteSession(t.db, token);
    expect(await readSession(t.db, token)).toBeNull();
  });
});
