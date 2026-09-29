import { and, desc, eq, gte, sql } from "drizzle-orm";
import { PROVIDER_LINKS, STATIC_MODELS, SUBSCRIPTION_METHOD, type ProviderId } from "@autofarm/ai";
import { connectionsRepo, getAiSettings, listAllWorkspaces, schema } from "@autofarm/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { checkAiKey, deleteAiKey, disconnectSubscription, saveAi, saveAiKey, testAi, verifySubscription } from "./actions";
import { ClaudeTokenForm, DeviceConnect } from "./connect";

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex (OpenAI)" },
  { id: "muse", name: "Muse Spark" },
  { id: "gemini", name: "Gemini (API만)" },
];
const PURPOSES = [
  { key: "text.fast", label: "빠른 텍스트 (키워드 판별 등)" },
  { key: "text.quality", label: "품질 텍스트 (카피)" },
  { key: "image", label: "이미지 (P2)" },
];
const STATUS_KO: Record<string, string> = { ok: "연결됨", expired: "인증 실패", error: "오류", unset: "확인 중", blocked: "차단" };
function StatusBadge({ c }: { c?: { status: string } }) {
  if (!c) return <span className="badge">미연결</span>;
  return <span className={`badge ${c.status}`}>{STATUS_KO[c.status] ?? c.status}</span>;
}

const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export default async function AdminAiPage() {
  await requireAdmin();
  const d = db();
  const workspaces = await listAllWorkspaces(d);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await Promise.all(
    workspaces.map(async (w) => {
      const settings = await getAiSettings(d, w.id);
      const usage = await d
        .select({
          provider: schema.aiUsage.provider,
          model: schema.aiUsage.model,
          calls: sql<number>`count(*)::int`,
          ok: sql<number>`sum(case when ${schema.aiUsage.ok} then 1 else 0 end)::int`,
          // 한 건이라도 토큰이 없으면 합계도 비운다(추정하지 않음)
          inTok: sql<number | null>`case when bool_and(${schema.aiUsage.inputTokens} is not null) then sum(${schema.aiUsage.inputTokens})::int end`,
          outTok: sql<number | null>`case when bool_and(${schema.aiUsage.outputTokens} is not null) then sum(${schema.aiUsage.outputTokens})::int end`,
        })
        .from(schema.aiUsage)
        .where(and(eq(schema.aiUsage.workspaceId, w.id), gte(schema.aiUsage.at, monthStart)))
        .groupBy(schema.aiUsage.provider, schema.aiUsage.model);
      const [lastTest] = await d
        .select()
        .from(schema.jobRuns)
        .where(and(eq(schema.jobRuns.workspaceId, w.id), eq(schema.jobRuns.type, "ai.test")))
        .orderBy(desc(schema.jobRuns.createdAt))
        .limit(1);
      const keys = (await connectionsRepo(d, w.id).list()).filter((c) => c.kind.startsWith("ai:") || c.kind.startsWith("ai-sub:"));
      return { w, settings, usage, lastTest, keys };
    }),
  );

  return (
    <>
      <h2>AI 설정 (관리자)</h2>
      <p className="sub">
        워크스페이스마다 프로바이더·인증 방식·용도별 모델을 정합니다. 구독 방식은 계정 주인 본인 워크스페이스에만 씁니다. Muse Spark API는
        결제 등록(10-13 예정) 뒤에 켭니다.
      </p>
      {rows.map(({ w, settings, usage, lastTest, keys }) => (
        <div className="card" key={w.id}>
          <h3>{w.name}</h3>
          <datalist id={`models-${w.id}`}>
            {keys.flatMap((k) =>
              (Array.isArray(k.config.models) ? (k.config.models as string[]) : []).map((m) => (
                <option key={`${k.kind}-${m}`} value={m}>{`${k.kind.slice(3)} API · ${m}`}</option>
              )),
            )}
            {PROVIDERS.flatMap((p) =>
              STATIC_MODELS[p.id].filter((m) => !m.hidden).map((m) => <option key={`${p.id}-${m.id}`} value={m.id}>{`${p.name} · ${m.label}`}</option>),
            )}
          </datalist>
          <details open style={{ marginBottom: 14 }}>
            <summary>
              <b>AI 연결</b> <span className="muted">— 구독(내 요금제로 로그인) 또는 API 키 중 하나를 연결하고, 아래 「인증 방식」에서 고릅니다.</span>
            </summary>
            <div className="ai-grid">
              {PROVIDERS.map((p) => {
                const key = keys.find((c) => c.kind === `ai:${p.id}`);
                const sub = keys.find((c) => c.kind === `ai-sub:${p.id}`);
                const link = PROVIDER_LINKS[p.id];
                const method = SUBSCRIPTION_METHOD[p.id];
                const models = key && Array.isArray(key.config.models) ? (key.config.models as string[]).length : 0;
                return (
                  <div key={p.id} className="ai-card">
                    <h4>{link.name}</h4>

                    <div className="ai-row">
                      <div className="ai-head">
                        <b>구독</b> <StatusBadge c={sub} />
                        {link.subscriptionUrl && (
                          <a href={link.subscriptionUrl} target="_blank" rel="noopener noreferrer" className="muted">
                            요금제 보기 ↗
                          </a>
                        )}
                      </div>
                      {sub?.statusMessage && <div className="muted">{sub.statusMessage}</div>}
                      {method === "device" && <DeviceConnect workspaceId={w.id} provider={p.id} connected={sub?.status === "ok"} />}
                      {method === "token" && <ClaudeTokenForm workspaceId={w.id} connected={Boolean(sub)} />}
                      {method === "none" && <p className="muted">구독으로는 쓸 수 없습니다(2026-06-18 개인 로그인 종료). API 키로 연결하세요.</p>}
                      {sub && (
                        <div className="actions" style={{ marginTop: 6 }}>
                          <form action={verifySubscription}><input type="hidden" name="workspaceId" value={w.id} /><input type="hidden" name="provider" value={p.id} /><button className="ghost">확인</button></form>
                          <form action={disconnectSubscription}><input type="hidden" name="workspaceId" value={w.id} /><input type="hidden" name="provider" value={p.id} /><button className="danger">해제</button></form>
                        </div>
                      )}
                    </div>

                    <div className="ai-row">
                      <div className="ai-head">
                        <b>API 키</b> <StatusBadge c={key} />
                        <a href={link.apiKeyUrl} target="_blank" rel="noopener noreferrer">
                          키 발급 페이지 ↗
                        </a>
                      </div>
                      <div className="muted">{link.apiKeyNote}{key?.secretHint ? ` · 저장된 키 ${key.secretHint}` : ""}{models ? ` · 모델 ${models}개` : ""}</div>
                      {key?.statusMessage && <div className="muted">{key.statusMessage}</div>}
                      <form action={saveAiKey} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <input type="hidden" name="workspaceId" value={w.id} />
                        <input type="hidden" name="provider" value={p.id} />
                        <input name="api_key" type="password" autoComplete="off" placeholder={key ? "새 키로 교체" : "API 키 붙여넣기"} required style={{ minWidth: 160, flex: 1 }} aria-label={`${p.name} API 키`} />
                        {p.id === "muse" && (
                          <input name="base_url" placeholder="API 주소" defaultValue={typeof key?.config.base_url === "string" ? key.config.base_url : ""} required style={{ minWidth: 160, flex: 1 }} aria-label="Muse API 주소" />
                        )}
                        <button>연결</button>
                      </form>
                      {key && (
                        <div className="actions" style={{ marginTop: 6 }}>
                          <form action={checkAiKey}><input type="hidden" name="workspaceId" value={w.id} /><input type="hidden" name="provider" value={p.id} /><button className="ghost">확인</button></form>
                          <form action={deleteAiKey}><input type="hidden" name="workspaceId" value={w.id} /><input type="hidden" name="provider" value={p.id} /><button className="danger">삭제</button></form>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              구독 연결은 그 요금제 계정 주인 본인의 워크스페이스에서만 쓰세요(각 회사 약관). 다른 사람 워크스페이스에는 그 사람 계정이나 API 키를 연결합니다.
            </p>
          </details>
          <form action={saveAi}>
            <input type="hidden" name="workspaceId" value={w.id} />
            <div className="row">
              <div>
                <label htmlFor={`${w.id}-provider`}>프로바이더</label>
                <select id={`${w.id}-provider`} name="provider" defaultValue={settings?.provider ?? "muse"}>
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${w.id}-mode`}>인증 방식</label>
                <select id={`${w.id}-mode`} name="mode" defaultValue={settings?.mode ?? "api"}>
                  <option value="subscription">구독 (서버 CLI 로그인)</option>
                  <option value="api">API 키</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${w.id}-budget`}>월 예산 한도(원, 비우면 없음)</label>
                <input id={`${w.id}-budget`} name="budget" type="number" step="1000" defaultValue={settings?.monthlyBudgetKrw ?? ""} />
              </div>
              <div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 32 }}>
                  <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} style={{ width: "auto" }} /> 켜기
                </label>
              </div>
            </div>
            {PURPOSES.map((p) => (
              <div className="row" key={p.key}>
                <div>
                  <label htmlFor={`${w.id}-${p.key}-m`}>{p.label} · 모델</label>
                  <input id={`${w.id}-${p.key}-m`} name={`${p.key}.model`} list={`models-${w.id}`} defaultValue={settings?.models[p.key]?.model ?? ""} />
                </div>
                <div>
                  <label htmlFor={`${w.id}-${p.key}-e`}>노력</label>
                  <select id={`${w.id}-${p.key}-e`} name={`${p.key}.effort`} defaultValue={settings?.models[p.key]?.effort ?? ""}>
                    {EFFORTS.map((e) => (
                      <option key={e} value={e}>{e || "(기본)"}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div className="actions">
              <button>저장</button>
            </div>
          </form>
          <form action={testAi} className="actions">
            <input type="hidden" name="workspaceId" value={w.id} />
            <button className="ghost">AI 연결 시험</button>
            {lastTest && (
              <span className="muted">
                마지막 시험: <span className={`badge ${lastTest.status}`}>{lastTest.status}</span> {lastTest.message ?? ""}{" "}
                {lastTest.output ? JSON.stringify(lastTest.output) : ""}
              </span>
            )}
          </form>
          <details style={{ marginTop: 12 }}>
            <summary>이번 달 사용량</summary>
            {usage.length === 0 ? (
              <p className="muted">없음</p>
            ) : (
              <table>
                <thead>
                  <tr><th>프로바이더</th><th>모델</th><th>호출</th><th>성공</th><th>입력 토큰</th><th>출력 토큰</th></tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={`${u.provider}-${u.model}`}>
                      <td>{u.provider}</td>
                      <td>{u.model}</td>
                      <td>{u.calls}</td>
                      <td>{u.ok}</td>
                      <td>{u.inTok ?? "측정 불가"}</td>
                      <td>{u.outTok ?? "측정 불가"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        </div>
      ))}
    </>
  );
}
