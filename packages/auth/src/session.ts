import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { schema, type Db } from "@autofarm/db";

export const SESSION_COOKIE = "af_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: string, workspaceId: string | null, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: hashToken(token), userId, workspaceId, expiresAt });
  return { token, expiresAt };
}

export type SessionUser = { id: string; email: string; name: string; isAdmin: boolean; workspaceId: string | null };

export async function readSession(db: Db, token: string | undefined | null, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isAdmin: schema.users.isAdmin,
      workspaceId: schema.sessions.workspaceId,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, now)));
  return rows[0] ?? null;
}

export async function switchWorkspace(db: Db, token: string, workspaceId: string) {
  await db.update(schema.sessions).set({ workspaceId }).where(eq(schema.sessions.id, hashToken(token)));
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
}
