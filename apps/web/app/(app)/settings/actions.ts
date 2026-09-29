"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@autofarm/auth";
import { schema, updateWorkspace } from "@autofarm/db";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/session";

const Schema = z.object({
  name: z.string().trim().min(1).max(60),
  businessName: z.string().trim().max(60),
  businessNo: z.string().trim().max(20),
  taxType: z.enum(["general", "simple"]),
  entryPercent: z.coerce.number().min(5).max(80),
  leadDays: z.coerce.number().int().min(0).max(30),
  feeDaangn: z.coerce.number().min(0).max(0.5),
  feeCoupang: z.coerce.number().min(0).max(0.5),
  couponCoupang: z.coerce.number().int().min(0).max(100000),
});

export async function saveSettings(_prev: string | null, form: FormData): Promise<string | null> {
  const { workspace } = await requireWorkspace();
  const parsed = Schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return "입력값을 확인하세요: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  const d = parsed.data;
  await updateWorkspace(db(), workspace.id, {
    name: d.name,
    businessName: d.businessName || null,
    businessNo: d.businessNo || null,
    taxType: d.taxType,
    settings: {
      ...workspace.settings,
      params: { entryPercent: d.entryPercent, leadDays: d.leadDays, feeDaangn: d.feeDaangn, feeCoupang: d.feeCoupang, couponCoupang: d.couponCoupang },
    },
  });
  revalidatePath("/", "layout");
  return "저장했습니다";
}

export async function changePassword(_prev: string | null, form: FormData): Promise<string | null> {
  const { user } = await requireWorkspace();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 10) return "새 비밀번호는 10자 이상이어야 합니다";
  const [row] = await db().select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!row || !(await verifyPassword(current, row.passwordHash))) return "현재 비밀번호가 맞지 않습니다";
  await db().update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id));
  return "바꿨습니다";
}
