import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { aiSettings, memberships, users, workspaces, type TaxType } from "../schema";

export async function createUserWithWorkspace(
  db: Db,
  input: { email: string; name: string; passwordHash: string; isAdmin?: boolean; workspaceName: string; taxType?: TaxType },
) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: input.email.toLowerCase(), name: input.name, passwordHash: input.passwordHash, isAdmin: input.isAdmin ?? false })
      .returning();
    const [ws] = await tx.insert(workspaces).values({ name: input.workspaceName, taxType: input.taxType ?? "general" }).returning();
    await tx.insert(memberships).values({ workspaceId: ws!.id, userId: user!.id, role: "owner" });
    return { user: user!, workspace: ws! };
  });
}

export async function workspacesOfUser(db: Db, userId: string) {
  return db
    .select({ id: workspaces.id, name: workspaces.name, taxType: workspaces.taxType, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId));
}

export async function isMember(db: Db, userId: string, workspaceId: string) {
  const rows = await db
    .select({ w: memberships.workspaceId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  return rows.length > 0;
}

export async function updateWorkspace(
  db: Db,
  workspaceId: string,
  patch: Partial<{ name: string; businessName: string | null; businessNo: string | null; taxType: TaxType; settings: Record<string, unknown> }>,
) {
  const [row] = await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId)).returning();
  return row ?? null;
}

export async function getWorkspace(db: Db, workspaceId: string) {
  return (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)))[0] ?? null;
}

export async function listAllWorkspaces(db: Db) {
  return db.select().from(workspaces).orderBy(workspaces.createdAt);
}

export async function getAiSettings(db: Db, workspaceId: string) {
  return (await db.select().from(aiSettings).where(eq(aiSettings.workspaceId, workspaceId)))[0] ?? null;
}

export async function upsertAiSettings(db: Db, row: typeof aiSettings.$inferInsert) {
  const [r] = await db
    .insert(aiSettings)
    .values(row)
    .onConflictDoUpdate({ target: aiSettings.workspaceId, set: { ...row, updatedAt: new Date() } })
    .returning();
  return r!;
}
