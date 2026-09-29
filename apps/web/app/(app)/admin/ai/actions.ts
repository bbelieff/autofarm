"use server";
import { revalidatePath } from "next/cache";
import { AiError, createProvider, isSupported, looksLikeClaudeToken, type AuthMode, type ProviderId } from "@autofarm/ai";
import { connectionsRepo, upsertAiSettings } from "@autofarm/db";
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { requireAdmin } from "@/lib/session";
import { mask, vault } from "@/lib/vault";

const PURPOSES = ["text.fast", "text.quality", "image"] as const;

export async function saveAi(form: FormData) {
  const { user } = await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const provider = String(form.get("provider")) as ProviderId;
  const mode = String(form.get("mode")) as AuthMode;
  if (!isSupported(provider, mode)) throw new Error("이 조합은 지원하지 않습니다(Gemini는 API만)");
  const models: Record<string, { model: string; effort?: string }> = {};
  for (const p of PURPOSES) {
    const model = String(form.get(`${p}.model`) ?? "").trim();
    const effort = String(form.get(`${p}.effort`) ?? "").trim();
    if (model) models[p] = effort ? { model, effort } : { model };
  }
  const budget = String(form.get("budget") ?? "").trim();
  await upsertAiSettings(db(), {
    workspaceId,
    enabled: form.get("enabled") === "on",
    provider,
    mode,
    models,
    monthlyBudgetKrw: budget ? Number(budget) : null,
    updatedBy: user.id,
  });
  revalidatePath("/admin/ai");
}

export async function testAi(form: FormData) {
  await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const j = await jobs();
  await j.enqueue({ workspaceId, type: "ai.test", key: `ai-test:${Date.now()}` });
  revalidatePath("/admin/ai");
}

// ─── API 키 연결 도구 ─────────────────────────────────────────────

const API_PROVIDERS: ProviderId[] = ["claude", "codex", "muse", "gemini"];

function readProvider(form: FormData): ProviderId {
  const p = String(form.get("provider")) as ProviderId;
  if (!API_PROVIDERS.includes(p)) throw new Error("알 수 없는 프로바이더");
  return p;
}

async function findKeyConnection(workspaceId: string, provider: ProviderId) {
  return (await connectionsRepo(db(), workspaceId).list()).find((c) => c.kind === `ai:${provider}`) ?? null;
}

/** 키 저장(없으면 만들고 있으면 교체). 저장 직후 확인까지 한다. */
export async function saveAiKey(form: FormData) {
  const { user } = await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const provider = readProvider(form);
  const apiKey = String(form.get("api_key") ?? "").trim();
  const baseUrl = String(form.get("base_url") ?? "").trim();
  if (!apiKey) throw new Error("API 키를 입력하세요");
  if (provider === "muse" && !baseUrl) throw new Error("Muse Spark는 API 주소가 필요합니다");
  const kind = `ai:${provider}`;
  const repo = connectionsRepo(db(), workspaceId);
  const sealed = vault().encrypt(JSON.stringify({ api_key: apiKey }), `${workspaceId}|${kind}`);
  const existing = await findKeyConnection(workspaceId, provider);
  const config = baseUrl ? { base_url: baseUrl } : {};
  if (existing) {
    await repo.updateSecret(existing.id, sealed, mask(apiKey), user.id);
    await repo.updateConfig(existing.id, config);
  } else {
    await repo.create({ kind, label: `${provider} API`, authType: "api_key", secret: sealed, secretHint: mask(apiKey), config, userId: user.id });
  }
  await check(workspaceId, provider);
  revalidatePath("/admin/ai");
}

export async function checkAiKey(form: FormData) {
  await requireAdmin();
  await check(String(form.get("workspaceId")), readProvider(form));
  revalidatePath("/admin/ai");
}

export async function deleteAiKey(form: FormData) {
  const { user } = await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const conn = await findKeyConnection(workspaceId, readProvider(form));
  if (conn) await connectionsRepo(db(), workspaceId).remove(conn.id, user.id);
  revalidatePath("/admin/ai");
}

/** 키로 모델 목록을 불러와 연결 상태와 모델 목록을 기록한다(키 원문은 기록하지 않음). */
async function check(workspaceId: string, provider: ProviderId) {
  const repo = connectionsRepo(db(), workspaceId);
  const conn = await findKeyConnection(workspaceId, provider);
  if (!conn?.secret) return;
  const { api_key } = JSON.parse(vault().decrypt(conn.secret, `${workspaceId}|${conn.kind}`)) as { api_key: string };
  const baseUrl = typeof conn.config.base_url === "string" ? conn.config.base_url : undefined;
  try {
    const models = await createProvider({ provider, mode: "api", apiKey: api_key, baseUrl }).listModels();
    const listed = models.filter((m) => m.source === "api");
    if (!listed.length) throw new AiError("모델 목록을 받지 못했습니다(키·주소 확인)", "bad_response");
    await repo.updateConfig(conn.id, { ...conn.config, models: listed.map((m) => m.id), modelsAt: new Date().toISOString() });
    await repo.setStatus(conn.id, "ok", `모델 ${listed.length}개 확인`);
  } catch (e) {
    const raw = e instanceof Error ? e.message : "확인 실패";
    // 제공자 응답 JSON 안의 message 만 보여준다
    const message = /"message"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? raw;
    const authLike = (e instanceof AiError && e.kind === "auth") || /api key not valid|invalid (x-)?api[- ]key|unauthori[sz]ed|incorrect api key/i.test(raw);
    await repo.setStatus(conn.id, authLike ? "expired" : "error", message.slice(0, 200));
  }
}

// ─── 구독 연결(공식 CLI 로그인) ─────────────────────────────────────

const subKind = (p: ProviderId) => `ai-sub:${p}`;

/** Codex·Muse: 서버가 기기 코드 로그인을 시작한다. 화면은 돌려받은 작업 ID로 진행을 지켜본다. */
export async function startSubscriptionLogin(workspaceId: string, provider: ProviderId): Promise<{ runId: string } | { error: string }> {
  await requireAdmin();
  if (provider !== "codex" && provider !== "muse") return { error: "이 프로바이더는 자동 로그인을 지원하지 않습니다" };
  const j = await jobs();
  const { run } = await j.enqueue({ workspaceId, type: "ai.login", key: `ai-login:${provider}:${Date.now()}`, input: { provider } });
  return { runId: run.id };
}

/** Claude: PC 에서 `claude setup-token` 으로 받은 토큰을 저장하고 바로 확인한다. */
export async function saveClaudeToken(_prev: string | null, form: FormData): Promise<string | null> {
  const { user } = await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const token = String(form.get("token") ?? "").trim();
  if (!looksLikeClaudeToken(token)) return "토큰 형식이 아닙니다. `claude setup-token` 이 마지막에 보여준 sk-ant-oat… 로 시작하는 값을 붙여넣으세요";
  const kind = subKind("claude");
  const repo = connectionsRepo(db(), workspaceId);
  const sealed = vault().encrypt(JSON.stringify({ token }), `${workspaceId}|${kind}`);
  const existing = (await repo.list()).find((c) => c.kind === kind);
  if (existing) await repo.updateSecret(existing.id, sealed, mask(token), user.id);
  else await repo.create({ kind, label: "claude 구독", authType: "oauth", secret: sealed, secretHint: mask(token), config: {}, userId: user.id });
  const j = await jobs();
  await j.enqueue({ workspaceId, type: "ai.verify", key: `ai-verify:claude:${Date.now()}`, input: { provider: "claude" } });
  revalidatePath("/admin/ai");
  return "저장했습니다 — 연결을 확인하는 중입니다(몇 초 뒤 새로고침)";
}

export async function verifySubscription(form: FormData) {
  await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const provider = readProvider(form);
  const j = await jobs();
  await j.enqueue({ workspaceId, type: "ai.verify", key: `ai-verify:${provider}:${Date.now()}`, input: { provider } });
  revalidatePath("/admin/ai");
}

export async function disconnectSubscription(form: FormData) {
  await requireAdmin();
  const workspaceId = String(form.get("workspaceId"));
  const provider = readProvider(form);
  const j = await jobs();
  await j.enqueue({ workspaceId, type: "ai.logout", key: `ai-logout:${provider}:${Date.now()}`, input: { provider } });
  revalidatePath("/admin/ai");
}
