import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isMember, schema } from "@autofarm/db";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

/** 작업 진행 상태(화면이 몇 초마다 확인). 관리자이거나 그 워크스페이스 구성원만. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 ID" }, { status: 400 });
  const [run] = await db().select().from(schema.jobRuns).where(eq(schema.jobRuns.id, id));
  if (!run) return NextResponse.json({ error: "없음" }, { status: 404 });
  if (!user.isAdmin && !(await isMember(db(), user.id, run.workspaceId))) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return NextResponse.json(
    { status: run.status, progress: run.progress, message: run.message, output: run.output, type: run.type },
    { headers: { "cache-control": "no-store" } },
  );
}
