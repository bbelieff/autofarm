import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { AiError, createProvider, startDeviceLogin, subscriptionEnvFor, type ProviderId } from "@autofarm/ai";
import { connectionsRepo, type Db } from "@autofarm/db";
import type { JobHandler } from "@autofarm/jobs";
import type { Vault } from "@autofarm/vault";

/** 서버에 설치된 구독 CLI 경로(없으면 PATH 의 기본 이름) */
export const CLI_ENV: Record<ProviderId, string> = { claude: "CLAUDE_BIN", codex: "CODEX_BIN", muse: "MUSE_BIN", gemini: "" };
export const cliPathOf = (p: ProviderId) => (CLI_ENV[p] ? process.env[CLI_ENV[p]] : undefined) ?? p;

/** 워크스페이스·프로바이더별 로그인 폴더 */
export function aiHomeOf(workspaceId: string, provider: ProviderId) {
  const root = process.env.AI_HOME ?? path.resolve(process.cwd(), "../../storage/ai");
  return path.join(root, workspaceId, provider);
}

export const subKind = (p: ProviderId) => `ai-sub:${p}`;

async function upsertSub(db: Db, workspaceId: string, provider: ProviderId, patch: { status: "ok" | "error" | "expired" | "unset"; message: string; secret?: Parameters<ReturnType<typeof connectionsRepo>["updateSecret"]>[1]; hint?: string | null }) {
  const repo = connectionsRepo(db, workspaceId);
  let conn = (await repo.list()).find((c) => c.kind === subKind(provider)) ?? null;
  if (!conn) {
    conn = await repo.create({ kind: subKind(provider), label: `${provider} 구독`, authType: "oauth", secret: patch.secret ?? null, secretHint: patch.hint ?? null, config: {} });
  } else if (patch.secret !== undefined) {
    conn = (await repo.updateSecret(conn.id, patch.secret, patch.hint ?? null)) ?? conn;
  }
  await repo.setStatus(conn.id, patch.status, patch.message);
  return conn;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: "ignore", shell: process.platform === "win32" });
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", () => resolve(-1));
    child.on("close", (code) => {
      clearTimeout(t);
      resolve(code ?? -1);
    });
  });
}

/** CLI 가 요구하는 로그인 폴더를 미리 만든다(Codex 는 CODEX_HOME 이 없으면 실패) */
export async function ensureDirs(provider: ProviderId, dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const v of Object.values(subscriptionEnvFor(provider, dir))) {
    const target = v.endsWith(".json") ? path.dirname(v) : v;
    if (target.startsWith(dir)) await mkdir(target, { recursive: true, mode: 0o700 });
  }
}

/** Codex·Muse 기기 코드 로그인: 링크·코드를 화면에 보내고 승인을 기다린다. */
export function aiLoginHandler(db: Db): JobHandler {
  return async (ctx) => {
    const provider = String(ctx.input.provider) as ProviderId;
    if (provider !== "codex" && provider !== "muse") throw new Error("이 프로바이더는 자동 로그인을 지원하지 않습니다");
    const dir = aiHomeOf(ctx.workspaceId, provider);
    await ensureDirs(provider, dir);
    const h = startDeviceLogin({ provider, cliPath: cliPathOf(provider), dir, timeoutMs: 14 * 60_000 });
    let prompt: { url: string; code: string };
    try {
      prompt = await h.prompt;
    } catch (e) {
      await upsertSub(db, ctx.workspaceId, provider, { status: "error", message: "로그인을 시작하지 못했습니다(서버에 CLI 확인)" });
      throw e;
    }
    await ctx.report({ url: prompt.url, code: prompt.code, expiresAt: new Date(Date.now() + 14 * 60_000).toISOString() });
    await ctx.progress(0.5, "브라우저에서 승인을 기다리는 중");
    const ok = await h.done;
    const env = { ...process.env, ...subscriptionEnvFor(provider, dir) } as NodeJS.ProcessEnv;
    const verified =
      ok && (provider === "codex" ? (await run(cliPathOf("codex"), ["login", "status"], env)) === 0 : existsSync(subscriptionEnvFor("muse", dir).MUSE_AUTH_PATH!));
    if (!verified) {
      await upsertSub(db, ctx.workspaceId, provider, { status: "error", message: "승인되지 않았거나 시간이 지났습니다 — 다시 연결하세요" });
      throw new Error("로그인이 완료되지 않았습니다");
    }
    await upsertSub(db, ctx.workspaceId, provider, { status: "ok", message: "구독 로그인됨" });
    return { connected: true };
  };
}

/** 구독 연결 확인: 짧은 문장 1회 호출(Claude 토큰 붙여넣기 뒤, 또는 「확인」 버튼) */
export function aiVerifyHandler(db: Db, vault: Vault): JobHandler {
  return async (ctx) => {
    const provider = String(ctx.input.provider) as ProviderId;
    const conn = (await connectionsRepo(db, ctx.workspaceId).list()).find((c) => c.kind === subKind(provider));
    const token = provider === "claude" && conn?.secret ? (JSON.parse(vault.decrypt(conn.secret, `${ctx.workspaceId}|${conn.kind}`)) as { token: string }).token : undefined;
    const model = provider === "claude" ? "haiku" : provider === "codex" ? "gpt-5.5" : "muse-spark-1.3";
    const home = aiHomeOf(ctx.workspaceId, provider);
    await ensureDirs(provider, home);
    const p = createProvider({ provider, mode: "subscription", cliPath: cliPathOf(provider), env: subscriptionEnvFor(provider, home, token) });
    try {
      const r = await p.generate({ model, effort: "low", prompt: "Reply with exactly: OK", timeoutMs: 120_000, purpose: "ai.verify" });
      await upsertSub(db, ctx.workspaceId, provider, { status: "ok", message: `구독 연결 확인(${Math.round(r.elapsedMs / 100) / 10}초)` });
      return { reply: r.text.slice(0, 20), model: r.model };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : "확인 실패";
      const auth = (e instanceof AiError && e.kind === "auth") || /authenticat|not logged in|401/i.test(msg);
      await upsertSub(db, ctx.workspaceId, provider, { status: auth ? "expired" : "error", message: auth ? `인증 실패 — 토큰을 다시 받아 연결하세요 (${msg})` : msg });
      throw e;
    }
  };
}

/** 구독 연결 해제: 로그인 폴더와 연결 기록을 지운다. */
export function aiLogoutHandler(db: Db): JobHandler {
  return async (ctx) => {
    const provider = String(ctx.input.provider) as ProviderId;
    await rm(aiHomeOf(ctx.workspaceId, provider), { recursive: true, force: true });
    const repo = connectionsRepo(db, ctx.workspaceId);
    const conn = (await repo.list()).find((c) => c.kind === subKind(provider));
    if (conn) await repo.remove(conn.id);
    return { removed: true };
  };
}
