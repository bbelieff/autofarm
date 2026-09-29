import Link from "next/link";
import { connectionsRepo } from "@autofarm/db";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/session";

export default async function Home() {
  const { workspace } = await requireWorkspace();
  const conns = await connectionsRepo(db(), workspace.id).list();
  const ok = conns.filter((c) => c.status === "ok").length;
  return (
    <>
      <h2>홈</h2>
      <p className="sub">소싱 한 바퀴는 P1에서 열립니다. 지금은 연결을 먼저 준비합니다.</p>
      <div className="card">
        <h3>연결 상태</h3>
        <p>
          등록 {conns.length}개 · 정상 {ok}개 — <Link href="/connections">연결 설정으로</Link>
        </p>
      </div>
      <div className="card">
        <h3>한 바퀴 단계</h3>
        <p className="muted">S0 연결 → S1 수요발굴 → S2 시점검증 → S3 공급처매칭 → S4 가격 → S5 리포트 → S6 소재 → S7 상세 → S8 등록 → S9 발주 → S10 정산·세무</p>
      </div>
    </>
  );
}
