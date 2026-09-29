import Link from "next/link";
import { requireWorkspace } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();
  return (
    <div className="shell">
      <aside className="side">
        <h1>오토농장</h1>
        <div className="ws">{workspace.name} · {workspace.taxType === "simple" ? "간이과세" : "일반과세"}</div>
        <nav>
          <Link href="/">홈</Link>
          <Link href="/connections">연결 설정</Link>
          <Link href="/settings">워크스페이스 설정</Link>
          <Link href="/jobs">작업 기록</Link>
          {user.isAdmin && <Link href="/admin/ai">AI 설정 (관리자)</Link>}
        </nav>
        <div className="foot">
          {user.name}
          <br />
          <a href="/logout" style={{ color: "#b9c7ae" }}>로그아웃</a>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
