import { and, eq } from "drizzle-orm";
import { createProvider, type AiProvider, type ProviderId } from "@autofarm/ai";
import { getAiSettings, schema, type Db } from "@autofarm/db";
import type { Vault } from "@autofarm/vault";

/** 서버에 설치된 구독 CLI 경로(없으면 PATH 의 기본 이름) */
const CLI_ENV: Record<ProviderId, string> = { claude: "CLAUDE_BIN", codex: "CODEX_BIN", muse: "MUSE_BIN", gemini: "" };

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
  const envName = CLI_ENV[s.provider];
  const provider = createProvider(
    { provider: s.provider, mode: s.mode, apiKey, baseUrl, cliPath: envName ? process.env[envName] : undefined },
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
