import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { auditLog, connections, type ConnectionAuth, type ConnectionStatus, type SealedSecretJson } from "../schema";

export type ConnectionRow = typeof connections.$inferSelect;

/** 모든 조회·변경에 workspaceId 조건을 강제한다(워크스페이스 격리). */
export function connectionsRepo(db: Db, workspaceId: string) {
  const own = (id: string) => and(eq(connections.id, id), eq(connections.workspaceId, workspaceId));
  return {
    list: () => db.select().from(connections).where(eq(connections.workspaceId, workspaceId)).orderBy(connections.kind),
    get: async (id: string) => (await db.select().from(connections).where(own(id)))[0] ?? null,
    async create(input: {
      kind: string;
      label: string;
      authType: ConnectionAuth;
      secret: SealedSecretJson | null;
      secretHint: string | null;
      config?: Record<string, unknown>;
      consentPurpose?: string | null;
      retainUntil?: Date | null;
      userId?: string | null;
    }) {
      const [row] = await db
        .insert(connections)
        .values({
          workspaceId,
          kind: input.kind,
          label: input.label,
          authType: input.authType,
          secret: input.secret,
          secretHint: input.secretHint,
          config: input.config ?? {},
          consentAt: input.consentPurpose ? new Date() : null,
          consentPurpose: input.consentPurpose ?? null,
          retainUntil: input.retainUntil ?? null,
        })
        .returning();
      await db.insert(auditLog).values({ workspaceId, userId: input.userId ?? null, action: "connection.create", target: row!.id, detail: { kind: input.kind } });
      return row!;
    },
    async updateSecret(id: string, secret: SealedSecretJson | null, secretHint: string | null, userId?: string | null) {
      const [row] = await db
        .update(connections)
        .set({ secret, secretHint, status: "unset", statusMessage: null, updatedAt: new Date() })
        .where(own(id))
        .returning();
      if (row) await db.insert(auditLog).values({ workspaceId, userId: userId ?? null, action: "connection.secret", target: id });
      return row ?? null;
    },
    async updateConfig(id: string, config: Record<string, unknown>) {
      const [row] = await db.update(connections).set({ config, updatedAt: new Date() }).where(own(id)).returning();
      return row ?? null;
    },
    async setStatus(id: string, status: ConnectionStatus, message: string | null) {
      const [row] = await db
        .update(connections)
        .set({ status, statusMessage: message, lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(own(id))
        .returning();
      return row ?? null;
    },
    async remove(id: string, userId?: string | null) {
      const rows = await db.delete(connections).where(own(id)).returning({ id: connections.id });
      if (rows.length) await db.insert(auditLog).values({ workspaceId, userId: userId ?? null, action: "connection.delete", target: id });
      return rows.length > 0;
    },
  };
}

/** 보관 만료가 지난 세션 비밀을 파기하고 재로그인을 요구한다(모든 워크스페이스, 워커 전용). */
export async function purgeExpiredSecrets(db: Db, now = new Date()) {
  const expired = await db.select({ id: connections.id, workspaceId: connections.workspaceId, retainUntil: connections.retainUntil }).from(connections);
  let n = 0;
  for (const c of expired) {
    if (c.retainUntil && c.retainUntil <= now) {
      await db
        .update(connections)
        .set({ secret: null, secretHint: null, status: "expired", statusMessage: "보관 기간 만료 — 다시 로그인하세요", updatedAt: now })
        .where(eq(connections.id, c.id));
      await db.insert(auditLog).values({ workspaceId: c.workspaceId, action: "connection.purge", target: c.id });
      n++;
    }
  }
  return n;
}
