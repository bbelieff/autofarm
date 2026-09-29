"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { checkParams, effectiveParams, PARAM_FIELDS, sanitizeOverrides } from "@autofarm/config";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@autofarm/auth";
import { schema, updateWorkspace } from "@autofarm/db";
import { db } from "@/lib/db";
import { defaultParams } from "@/lib/params";
import { requireWorkspace } from "@/lib/session";

const Business = z.object({
  name: z.string().trim().min(1).max(60),
  businessName: z.string().trim().max(60),
  businessNo: z.string().trim().max(20),
  taxType: z.enum(["general", "simple"]),
});

export async function saveBusiness(_prev: string | null, form: FormData): Promise<string | null> {
  const { workspace } = await requireWorkspace();
  const parsed = Business.safeParse(Object.fromEntries(form));
  if (!parsed.success) return "입력값을 확인하세요: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  const d = parsed.data;
  await updateWorkspace(db(), workspace.id, {
    name: d.name,
    businessName: d.businessName || null,
    businessNo: d.businessNo || null,
    taxType: d.taxType,
  });
  revalidatePath("/", "layout");
  return "저장했습니다";
}

/** 소싱 기준: 기본값(교안 프리셋)과 다른 값만 워크스페이스에 저장한다. */
export async function saveParams(_prev: string | null, form: FormData): Promise<string | null> {
  const { workspace } = await requireWorkspace();
  const raw: Record<string, unknown> = {};
  for (const f of PARAM_FIELDS) {
    if (f.type === "boolean") raw[f.key] = form.get(f.key) === "on";
    else raw[f.key] = form.get(f.key);
  }
  const clean = sanitizeOverrides(raw);
  const rejected = PARAM_FIELDS.filter((f) => f.type !== "boolean" && raw[f.key] !== "" && !(f.key in clean)).map((f) => f.label);
  if (rejected.length) return `허용 범위를 벗어났습니다: ${rejected.join(", ")}`;
  const { defaults } = defaultParams();
  const errs = checkParams(effectiveParams(defaults, clean));
  if (errs.length) return errs.join(" · ");
  const overrides = Object.fromEntries(Object.entries(clean).filter(([k, v]) => defaults[k as keyof typeof defaults] !== v));
  await updateWorkspace(db(), workspace.id, { settings: { ...workspace.settings, params: overrides } });
  revalidatePath("/settings");
  return Object.keys(overrides).length ? `저장했습니다 (기본값과 다른 항목 ${Object.keys(overrides).length}개)` : "저장했습니다 (모두 기본값)";
}

export async function resetParams() {
  const { workspace } = await requireWorkspace();
  await updateWorkspace(db(), workspace.id, { settings: { ...workspace.settings, params: {} } });
  revalidatePath("/settings");
}

export async function changePassword(_prev: string | null, form: FormData): Promise<string | null> {
  const { user } = await requireWorkspace();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < MIN_PASSWORD_LENGTH) return `새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`;
  const [row] = await db().select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!row || !(await verifyPassword(current, row.passwordHash))) return "현재 비밀번호가 맞지 않습니다";
  await db().update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id));
  return "바꿨습니다";
}
