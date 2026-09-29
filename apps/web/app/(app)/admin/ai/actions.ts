"use server";
import { revalidatePath } from "next/cache";
import { AiError, createProvider, isSupported, type AuthMode, type ProviderId } from "@autofarm/ai";
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
