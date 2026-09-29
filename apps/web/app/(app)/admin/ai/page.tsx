import { and, desc, eq, gte, sql } from "drizzle-orm";
import { STATIC_MODELS, type ProviderId } from "@autofarm/ai";
import { getAiSettings, listAllWorkspaces, schema } from "@autofarm/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { saveAi, testAi } from "./actions";

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
      return { w, settings, usage, lastTest };
    }),
  );

  return (
    <>
      <h2>AI 설정 (관리자)</h2>
      <p className="sub">
        워크스페이스마다 프로바이더·인증 방식·용도별 모델을 정합니다. 구독 방식은 계정 주인 본인 워크스페이스에만 씁니다. Muse Spark API는
        결제 등록(10-13 예정) 뒤에 켭니다.
      </p>
      <datalist id="models-all">
        {PROVIDERS.flatMap((p) =>
          STATIC_MODELS[p.id]
            .filter((m) => !m.hidden)
            .map((m) => <option key={`${p.id}-${m.id}`} value={m.id}>{`${p.name} · ${m.label}`}</option>),
        )}
      </datalist>
      {rows.map(({ w, settings, usage, lastTest }) => (
        <div className="card" key={w.id}>
          <h3>{w.name}</h3>
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
                  <input id={`${w.id}-${p.key}-m`} name={`${p.key}.model`} list="models-all" defaultValue={settings?.models[p.key]?.model ?? ""} />
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
