import { connectionsRepo, purgeExpiredSecrets, type Db } from "@autofarm/db";
import { statusFromError } from "@autofarm/connectors";
import type { Vault } from "@autofarm/vault";
import type { JobHandler } from "@autofarm/jobs";
import { HEALTH_CHECKS } from "./health";
import { workspaceAi } from "./ai";

export function healthHandler(db: Db, vault: Vault, fetchFn: typeof fetch = fetch): JobHandler {
  return async (ctx) => {
    const repo = connectionsRepo(db, ctx.workspaceId);
    const id = String(ctx.input.connectionId ?? "");
    const conn = await repo.get(id);
    if (!conn) return { skipped: "연결 없음" };
    const check = HEALTH_CHECKS[conn.kind];
    if (!check) {
      await repo.setStatus(id, conn.status, "이 연결의 점검기는 아직 없습니다");
      return { skipped: "점검기 없음" };
    }
    if (!conn.secret) {
      await repo.setStatus(id, "expired", "비밀값이 없습니다 — 다시 입력하세요");
      return { status: "expired" };
    }
    const secrets = JSON.parse(vault.decrypt(conn.secret, `${ctx.workspaceId}|${conn.kind}`)) as Record<string, string>;
    try {
      const r = await check(secrets, fetchFn);
      await repo.setStatus(id, r.status, r.message);
      return { status: r.status };
    } catch (e) {
      const status = statusFromError(e);
      await repo.setStatus(id, status, e instanceof Error ? e.message : "점검 실패");
      return { status };
    }
  };
}

export function purgeHandler(db: Db): JobHandler {
  return async () => ({ purged: await purgeExpiredSecrets(db) });
}

/** 관리자 화면의 「AI 연결 시험」: 짧은 문장 1회 호출 */
export function aiTestHandler(db: Db, vault: Vault): JobHandler {
  return async (ctx) => {
    const ai = await workspaceAi(db, vault, ctx.workspaceId);
    if (!ai) return { skipped: "AI 꺼짐" };
    const m = ai.models["text.fast"] ?? ai.models["text.quality"];
    if (!m) throw new Error("text.fast 모델이 지정되지 않았습니다");
    const r = await ai.provider.generate({ model: m.model, effort: m.effort as never, prompt: "Reply with exactly: OK", purpose: "ai.test", timeoutMs: 120_000 });
    return { reply: r.text.slice(0, 20), model: r.model, inputTokens: r.usage?.inputTokens ?? null, outputTokens: r.usage?.outputTokens ?? null, elapsedMs: r.elapsedMs };
  };
}
