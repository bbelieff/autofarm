import { and, eq } from "drizzle-orm";
import { createProvider, subscriptionEnvFor, type AiProvider } from "@autofarm/ai";
import { getAiSettings, schema, type Db } from "@autofarm/db";
import type { Vault } from "@autofarm/vault";
import { aiHomeOf, cliPathOf, subKind } from "./ai-sub";

/** 워크스페이스 AI 설정대로 프로바이더를 만들고, 호출마다 ai_usage 에 기록한다(프롬프트·응답 원문은 저장하지 않음). */
export async function workspaceAi(db: Db, vault: Vault, workspaceId: string): Promise<{ provider: AiProvider; models: Record<string, { model: string; effort?: string }> } | null> {
  const s = await getAiSettings(db, workspaceId);
  if (!s || !s.enabled) return null;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  if (s.mode === "api") {
    const kind = `ai:${s.provider}`;
    const [conn] = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.workspaceId, workspaceId), eq(schema.connections.kind, kind)));
    if (!conn?.secret) throw new Error(`${kind} API 키가 연결 설정에 없습니다`);
    apiKey = (JSON.parse(vault.decrypt(conn.secret, `${workspaceId}|${kind}`)) as { api_key: string }).api_key;
    baseUrl = typeof conn.config.base_url === "string" ? conn.config.base_url : undefined;
  }
  let env: Record<string, string> | undefined;
  if (s.mode === "subscription") {
    // 워크스페이스 전용 로그인 폴더(Codex·Muse) 또는 붙여넣은 토큰(Claude)
    let token: string | undefined;
    if (s.provider === "claude") {
      const [sub] = await db
        .select()
        .from(schema.connections)
        .where(and(eq(schema.connections.workspaceId, workspaceId), eq(schema.connections.kind, subKind("claude"))));
      if (sub?.secret) token = (JSON.parse(vault.decrypt(sub.secret, `${workspaceId}|${sub.kind}`)) as { token: string }).token;
    }
    env = subscriptionEnvFor(s.provider, aiHomeOf(workspaceId, s.provider), token);
  }
  const provider = createProvider(
    { provider: s.provider, mode: s.mode, apiKey, baseUrl, cliPath: cliPathOf(s.provider), env },
    {
      onUsage: (r) => {
        void db
          .insert(schema.aiUsage)
          .values({
            workspaceId,
            provider: r.provider,
            mode: r.mode,
            model: r.model,
            effort: r.effort,
            ok: r.ok,
            errorKind: r.errorKind ?? null,
            inputTokens: r.usage?.inputTokens ?? null,
            outputTokens: r.usage?.outputTokens ?? null,
            elapsedMs: Math.round(r.elapsedMs),
            purpose: r.purpose ?? null,
          })
          .catch((e: unknown) => console.error("[ai_usage]", e instanceof Error ? e.message : e));
      },
    },
  );
  return { provider, models: s.models };
}
