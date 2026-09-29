import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE, type SessionUser } from "@autofarm/auth";
import { getWorkspace, isMember, workspacesOfUser } from "@autofarm/db";
import { db } from "./db";

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSession(db(), token);
}

/** 로그인 + 현재 워크스페이스 소속을 확인한다. 아니면 로그인 화면으로. */
export async function requireWorkspace() {
  const user = await currentUser();
  if (!user) redirect("/login");
  let wsId = user.workspaceId;
  if (!wsId || !(await isMember(db(), user.id, wsId))) {
    const first = (await workspacesOfUser(db(), user.id))[0];
    if (!first) redirect("/login?e=no-workspace");
    wsId = first.id;
  }
  const workspace = (await getWorkspace(db(), wsId))!;
  return { user, workspace };
}

export async function requireAdmin() {
  const ctx = await requireWorkspace();
  if (!ctx.user.isAdmin) redirect("/");
  return ctx;
}
