import { spawn } from "node:child_process";
import path from "node:path";
import type { ProviderId } from "./types";

/**
 * 구독(공식 CLI) 연결 도우미.
 * - Codex·Muse: 서버에서 기기 코드 로그인(링크 + 1회용 코드)을 대신 시작한다.
 * - Claude: 토큰 발급이 터미널 화면을 요구하므로, 사용자가 PC에서 `claude setup-token` 으로 받은 토큰을 붙여넣는다.
 * - Gemini: 구독 경로 없음(API 키만).
 * 로그인 정보는 워크스페이스마다 분리된 폴더(dir)에 저장된다.
 */

export type SubscriptionMethod = "device" | "token" | "none";

export const SUBSCRIPTION_METHOD: Record<ProviderId, SubscriptionMethod> = {
  codex: "device",
  muse: "device",
  claude: "token",
  gemini: "none",
};

/** 워크스페이스 전용 로그인 폴더를 가리키는 환경변수 */
export function subscriptionEnvFor(provider: ProviderId, dir: string, token?: string): Record<string, string> {
  switch (provider) {
    case "codex":
      return { CODEX_HOME: path.join(dir, "codex") };
    case "muse":
      return { MUSE_AUTH_PATH: path.join(dir, "muse", "auth.json"), XDG_CONFIG_HOME: path.join(dir, "muse-config") };
    case "claude":
      return { CLAUDE_CONFIG_DIR: path.join(dir, "claude"), ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) };
    default:
      return {};
  }
}

export function deviceLoginArgs(provider: ProviderId): string[] | null {
  if (provider === "codex") return ["login", "--device-auth"];
  if (provider === "muse") return ["login"];
  return null;
}

// eslint-disable-next-line no-control-regex -- 터미널 색상 코드 제거용
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");

/** CLI 출력에서 로그인 링크와 1회용 코드를 찾는다. */
export function parseDeviceLogin(output: string): { url: string; code: string } | null {
  const text = stripAnsi(output);
  const url = /https:\/\/[^\s"'<>]+/.exec(text)?.[0];
  if (!url) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let code: string | undefined;
  const idx = lines.findIndex((l) => /(enter|confirm) (this|the) (one-time )?code|one-time code/i.test(l));
  if (idx >= 0) code = lines.slice(idx + 1).find((l) => l.length > 0 && !l.startsWith("http"))?.split(/\s+/)[0];
  code ??= /\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/.exec(text)?.[0];
  return code ? { url, code } : null;
}

/** 토큰 형식 간단 검사(값은 기록하지 않음) */
export function looksLikeClaudeToken(t: string): boolean {
  return /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}$/.test(t.trim());
}

export type DeviceLoginHandle = {
  /** 링크·코드가 나오면 resolve (나오지 않고 끝나면 reject) */
  prompt: Promise<{ url: string; code: string }>;
  /** 사용자가 승인해 CLI 가 끝나면 resolve(true=성공) */
  done: Promise<boolean>;
  cancel(): void;
};

/** 기기 코드 로그인을 시작한다. timeoutMs 안에 승인되지 않으면 종료. */
export function startDeviceLogin(opts: {
  provider: ProviderId;
  cliPath: string;
  dir: string;
  timeoutMs?: number;
  spawnFn?: typeof spawn;
}): DeviceLoginHandle {
  const args = deviceLoginArgs(opts.provider);
  if (!args) throw new Error(`${opts.provider}: 기기 코드 로그인을 지원하지 않습니다`);
  const env = { ...process.env, ...subscriptionEnvFor(opts.provider, opts.dir) } as NodeJS.ProcessEnv;
  delete env.META_API_KEY;
  delete env.OPENAI_API_KEY;
  // Windows 의 npm 설치 CLI(.cmd)는 셸로만 실행된다(인자는 고정값)
  const child = (opts.spawnFn ?? spawn)(opts.cliPath, args, { env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  let buf = "";
  let promptResolve!: (v: { url: string; code: string }) => void;
  let promptReject!: (e: Error) => void;
  let prompted = false;
  const prompt = new Promise<{ url: string; code: string }>((res, rej) => {
    promptResolve = res;
    promptReject = rej;
  });
  const onData = (d: Buffer | string) => {
    buf += d.toString();
    if (buf.length > 20_000) buf = buf.slice(-20_000);
    if (!prompted) {
      const p = parseDeviceLogin(buf);
      if (p) {
        prompted = true;
        promptResolve(p);
      }
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 15 * 60_000);
  const done = new Promise<boolean>((resolve) => {
    child.on("error", (e) => {
      clearTimeout(timer);
      if (!prompted) promptReject(e);
      resolve(false);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (!prompted) promptReject(new Error(`로그인 안내가 나오지 않았습니다(종료 ${code ?? signal}): ${stripAnsi(buf).trim().slice(-300)}`));
      resolve(code === 0);
    });
  });
  return { prompt, done, cancel: () => child.kill("SIGTERM") };
}
