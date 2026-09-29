"use server";
import { revalidatePath } from "next/cache";
import { connectionsRepo } from "@autofarm/db";
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { requireWorkspace } from "@/lib/session";
import { mask, vault } from "@/lib/vault";
import { specOf } from "@/lib/catalog";

export const aadOf = async (workspaceId: string, kind: string) => `${workspaceId}|${kind}`;

function collect(kind: string, form: FormData) {
  const spec = specOf(kind);
  if (!spec) throw new Error("알 수 없는 연결 종류");
  const secret: Record<string, string> = {};
  const config: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = String(form.get(f.name) ?? "").trim();
    if (!v) throw new Error(`${f.label} 을(를) 입력하세요`);
    (f.secret ? secret : config)[f.name] = v;
  }
  return { spec, secret, config };
}

export async function createConnection(form: FormData) {
  const { user, workspace } = await requireWorkspace();
  const kind = String(form.get("kind"));
  const { spec, secret, config } = collect(kind, form);
  if (spec.adminOnly && !user.isAdmin) throw new Error("관리자만 등록할 수 있습니다");
  let consentPurpose: string | null = null;
  let retainUntil: Date | null = null;
  if (spec.sessionLogin) {
    if (form.get("consent") !== "on") throw new Error("대신 로그인 동의가 필요합니다");
    const days = Math.min(Math.max(Number(form.get("retain_days") ?? 90), 7), 365);
    consentPurpose = "본인 계정으로 공급가·검색량 수집";
    retainUntil = new Date(Date.now() + days * 86400_000);
  }
  const label = String(config.supplier_name ?? form.get("label") ?? spec.title);
  const firstSecret = Object.values(secret)[0] ?? "";
  await connectionsRepo(db(), workspace.id).create({
    kind,
    label,
    authType: spec.authType,
    secret: vault().encrypt(JSON.stringify(secret), await aadOf(workspace.id, kind)),
    secretHint: mask(firstSecret),
    config,
    consentPurpose,
    retainUntil,
    userId: user.id,
  });
  revalidatePath("/connections");
}

export async function deleteConnection(form: FormData) {
  const { user, workspace } = await requireWorkspace();
  await connectionsRepo(db(), workspace.id).remove(String(form.get("id")), user.id);
  revalidatePath("/connections");
}

export async function checkConnection(form: FormData) {
  const { workspace } = await requireWorkspace();
  const id = String(form.get("id"));
  const conn = await connectionsRepo(db(), workspace.id).get(id);
  if (!conn) return;
  const j = await jobs();
  // 분 단위 키: 같은 분에 여러 번 눌러도 한 번만 실행
  await j.enqueue({ workspaceId: workspace.id, type: "connection.health", key: `health:${id}:${new Date().toISOString().slice(0, 16)}`, input: { connectionId: id } });
  revalidatePath("/connections");
}
