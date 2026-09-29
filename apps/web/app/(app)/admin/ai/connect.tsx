"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProviderId } from "@autofarm/ai";
import { saveClaudeToken, startSubscriptionLogin } from "./actions";

export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // 클립보드 권한이 없으면 무시(값은 화면에 보임)
        }
      }}
    >
      {done ? "복사됨" : label}
    </button>
  );
}

type Run = { status: string; message: string | null; output: { url?: string; code?: string; expiresAt?: string } | null };

/** Codex·Muse 자동 연결: 버튼 → 서버가 로그인 시작 → 링크·코드 표시 → 승인되면 자동으로 연결됨 */
export function DeviceConnect({ workspaceId, provider, connected }: { workspaceId: string; provider: ProviderId; connected: boolean }) {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${runId}`, { cache: "no-store" });
        if (res.ok) {
          const r = (await res.json()) as Run;
          if (stop) return;
          setRun(r);
          if (r.status === "succeeded") {
            router.refresh();
            return;
          }
          if (r.status === "failed" || r.status === "dead") return;
        }
      } catch {
        // 잠깐의 네트워크 오류는 다음 확인에서 다시
      }
      if (!stop) setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [runId, router]);

  const start = async () => {
    setError(null);
    setRun(null);
    setStarting(true);
    const r = await startSubscriptionLogin(workspaceId, provider);
    setStarting(false);
    if ("error" in r) setError(r.error);
    else setRunId(r.runId);
  };

  const url = run?.output?.url;
  const code = run?.output?.code;
  const waiting = runId && run?.status !== "succeeded" && run?.status !== "failed" && run?.status !== "dead";

  return (
    <div>
      {!waiting && (
        <button type="button" onClick={start} disabled={starting}>
          {starting ? "시작 중…" : connected ? "다시 연결" : "자동 연결"}
        </button>
      )}
      {waiting && !url && <p className="muted">서버에서 로그인을 준비하는 중… (몇 초)</p>}
      {waiting && url && code && (
        <div className="notice" style={{ marginTop: 8 }}>
          <div>
            <b>①</b>{" "}
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              로그인 페이지 열기 ↗
            </a>
          </div>
          <div style={{ marginTop: 8 }}>
            <b>②</b> 이 코드를 입력(또는 확인)하세요: <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>{code}</code>{" "}
            <CopyButton text={code} label="코드 복사" />
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            ③ 승인하면 이 화면이 저절로 「연결됨」으로 바뀝니다. 코드는 15분 안에 써야 합니다.
          </div>
        </div>
      )}
      {run?.status === "succeeded" && <p className="muted">연결됐습니다.</p>}
      {(run?.status === "failed" || run?.status === "dead") && <p className="err">{run.message ?? "연결하지 못했습니다"} — 다시 시도하세요</p>}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

/** Claude 구독: PC 에서 토큰을 받아 붙여넣기 */
export function ClaudeTokenForm({ workspaceId, connected }: { workspaceId: string; connected: boolean }) {
  const [msg, action, pending] = useActionState(saveClaudeToken, null);
  return (
    <form action={action}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <ol style={{ margin: "4px 0 8px", paddingLeft: 18, fontSize: 13 }}>
        <li>
          Claude Code가 없으면 설치:{" "}
          <a href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noopener noreferrer">
            설치 안내 ↗
          </a>
        </li>
        <li>
          내 PC 터미널에서 실행 <code>claude setup-token</code> <CopyButton text="claude setup-token" /> → 브라우저에서 로그인
        </li>
        <li>마지막에 나온 토큰(sk-ant-oat…)을 아래에 붙여넣기</li>
      </ol>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input name="token" type="password" autoComplete="off" placeholder={connected ? "새 토큰으로 교체" : "sk-ant-oat…"} required style={{ flex: 1, minWidth: 200 }} aria-label="Claude 구독 토큰" />
        <button disabled={pending}>{pending ? "저장 중…" : "연결"}</button>
      </div>
      {msg && <p className={msg.startsWith("저장") ? "muted" : "err"}>{msg}</p>}
    </form>
  );
}
