"use server";
import { revalidatePath } from "next/cache";
import { isSupported, type AuthMode, type ProviderId } from "@autofarm/ai";
import { upsertAiSettings } from "@autofarm/db";
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { requireAdmin } from "@/lib/session";

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
