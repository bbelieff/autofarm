import { desc, eq } from "drizzle-orm";
import { schema } from "@autofarm/db";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/session";

const KO: Record<string, string> = { queued: "대기", running: "실행 중", succeeded: "완료", failed: "실패(재시도)", dead: "실패", waiting_human: "사람 확인 대기" };

export default async function JobsPage() {
  const { workspace } = await requireWorkspace();
  const runs = await db()
    .select()
    .from(schema.jobRuns)
    .where(eq(schema.jobRuns.workspaceId, workspace.id))
    .orderBy(desc(schema.jobRuns.createdAt))
    .limit(50);
  return (
    <>
      <h2>작업 기록</h2>
      <p className="sub">점검·수집 같은 오래 걸리는 작업은 워커가 처리합니다. 최근 50건.</p>
      <div className="card">
        {runs.length === 0 ? (
          <p className="muted">아직 없습니다.</p>
        ) : (
          <table>
            <thead><tr><th>시각</th><th>종류</th><th>상태</th><th>진행</th><th>메시지</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.createdAt.toLocaleString("ko-KR")}</td>
                  <td>{r.type}</td>
                  <td><span className={`badge ${r.status}`}>{KO[r.status] ?? r.status}</span></td>
                  <td>{Math.round(r.progress * 100)}%</td>
                  <td className="muted">{r.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
