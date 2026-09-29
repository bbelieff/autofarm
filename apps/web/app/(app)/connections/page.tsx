import { connectionsRepo } from "@autofarm/db";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/session";
import { CATALOG, specOf } from "@/lib/catalog";
import { checkConnection, createConnection, deleteConnection } from "./actions";

const STATUS_KO: Record<string, string> = { unset: "미점검", ok: "정상", expired: "만료", blocked: "차단", error: "오류" };

export default async function ConnectionsPage() {
  const { user, workspace } = await requireWorkspace();
  const rows = await connectionsRepo(db(), workspace.id).list();
  const kinds = CATALOG.filter((k) => !k.adminOnly || user.isAdmin);
  return (
    <>
      <h2>연결 설정</h2>
      <p className="sub">공급처·데이터·채널 계정을 연결합니다. 비밀값은 암호화해 저장하고 화면에는 끝 4자리만 보입니다.</p>

      <div className="card">
        <h3>등록된 연결</h3>
        {rows.length === 0 ? (
          <p className="muted">아직 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr><th>종류</th><th>이름</th><th>비밀값</th><th>상태</th><th>마지막 점검</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const spec = specOf(c.kind);
                return (
                  <tr key={c.id}>
                    <td>{spec?.title ?? c.kind}</td>
                    <td>{c.label}{c.retainUntil && <div className="muted">보관 ~{c.retainUntil.toISOString().slice(0, 10)}</div>}</td>
                    <td className="muted">{c.secretHint ?? "-"}</td>
                    <td>
                      <span className={`badge ${c.status}`}>{STATUS_KO[c.status] ?? c.status}</span>
                      {c.statusMessage && <div className="muted">{c.statusMessage}</div>}
                    </td>
                    <td className="muted">{c.lastCheckedAt ? c.lastCheckedAt.toLocaleString("ko-KR") : "-"}</td>
                    <td>
                      <div className="actions" style={{ marginTop: 0 }}>
                        {spec?.healthCheck && (
                          <form action={checkConnection}><input type="hidden" name="id" value={c.id} /><button className="ghost">점검</button></form>
                        )}
                        <form action={deleteConnection}><input type="hidden" name="id" value={c.id} /><button className="danger">삭제</button></form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>새 연결</h3>
        {kinds.map((k) => (
          <details key={k.kind} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <summary>
              <b>{k.group}</b> · {k.title} {k.note && <span className="muted">— {k.note}</span>}
            </summary>
            <form action={createConnection}>
              <input type="hidden" name="kind" value={k.kind} />
              <div className="row">
                {k.fields.map((f) => (
                  <div key={f.name}>
                    <label htmlFor={`${k.kind}-${f.name}`}>{f.label}</label>
                    <input
                      id={`${k.kind}-${f.name}`}
                      name={f.name}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      placeholder={f.placeholder}
                      required
                    />
                  </div>
                ))}
              </div>
              {k.sessionLogin && (
                <>
                  <label htmlFor={`${k.kind}-days`}>보관 기간</label>
                  <select id={`${k.kind}-days`} name="retain_days" defaultValue="90">
                    <option value="30">30일</option>
                    <option value="90">90일</option>
                    <option value="180">180일</option>
                  </select>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" name="consent" style={{ width: "auto" }} required />
                    본인 계정이며, 오토농장이 이 계정으로 대신 로그인해 수집하는 것에 동의합니다. 캡차·2단계 인증은 자동으로 넘기지 않습니다.
                  </label>
                </>
              )}
              <div className="actions"><button type="submit">저장</button></div>
            </form>
          </details>
        ))}
      </div>
    </>
  );
}
