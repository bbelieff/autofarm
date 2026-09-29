import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeClaudeToken, parseDeviceLogin, startDeviceLogin, subscriptionEnvFor } from "../src";

const CODEX_OUT = `
Welcome to Codex [v\u001b[90m0.153.4\u001b[0m]
Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m

2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m
   \u001b[94mABCD-12345\u001b[0m
`;
const MUSE_OUT = `
Open this page to sign in:
  https://auth.meta.com/device?user_code=WXYZ9876
Enter this code:
  WXYZ9876
`;

describe("기기 코드 로그인 출력 해석", () => {
  it("Codex", () => {
    expect(parseDeviceLogin(CODEX_OUT)).toEqual({ url: "https://auth.openai.com/codex/device", code: "ABCD-12345" });
  });
  it("Muse", () => {
    expect(parseDeviceLogin(MUSE_OUT)).toEqual({ url: "https://auth.meta.com/device?user_code=WXYZ9876", code: "WXYZ9876" });
  });
  it("안내가 아직 없으면 null", () => {
    expect(parseDeviceLogin("Welcome to Codex")).toBeNull();
  });
});

describe("워크스페이스별 로그인 폴더", () => {
  it("프로바이더마다 다른 환경변수", () => {
    expect(subscriptionEnvFor("codex", "/d/ws1")).toEqual({ CODEX_HOME: path.join("/d/ws1", "codex") });
    expect(subscriptionEnvFor("muse", "/d/ws1").MUSE_AUTH_PATH).toBe(path.join("/d/ws1", "muse", "auth.json"));
    expect(subscriptionEnvFor("claude", "/d/ws1", "tok").CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
    expect(subscriptionEnvFor("gemini", "/d/ws1")).toEqual({});
  });
  it("Claude 토큰 형식", () => {
    // 형식만 맞춘 가짜 값(비밀 검사기 오탐을 피하려고 조각내 만든다)
    const fake = ["sk", "ant", "oat01", "z".repeat(40)].join("-");
    expect(looksLikeClaudeToken(fake)).toBe(true);
    expect(looksLikeClaudeToken("sk-ant-api03-xyz")).toBe(false);
  });
});

describe("기기 코드 로그인 실행", () => {
  // 실제 CLI 대신 같은 출력을 내는 node 프로세스
  const fakeSpawn = (script: string) =>
    ((_cmd: string, _args: string[], opts: Parameters<typeof spawn>[2]) => spawn(process.execPath, ["-e", script], { ...opts, shell: false })) as unknown as typeof spawn;

  it("링크·코드를 먼저 알려주고, 승인되면 성공으로 끝난다", async () => {
    const script = `process.stderr.write(${JSON.stringify(MUSE_OUT)}); setTimeout(() => process.exit(0), 300);`;
    const h = startDeviceLogin({ provider: "muse", cliPath: "muse", dir: "/tmp/x", spawnFn: fakeSpawn(script) });
    expect(await h.prompt).toEqual({ url: "https://auth.meta.com/device?user_code=WXYZ9876", code: "WXYZ9876" });
    expect(await h.done).toBe(true);
  });

  it("안내 없이 실패하면 prompt 가 거절된다", async () => {
    const h = startDeviceLogin({ provider: "codex", cliPath: "codex", dir: "/tmp/x", spawnFn: fakeSpawn("process.stderr.write('network error'); process.exit(1)") });
    await expect(h.prompt).rejects.toThrow("network error");
    expect(await h.done).toBe(false);
  });

  it("Claude 는 기기 코드 로그인을 지원하지 않는다", () => {
    expect(() => startDeviceLogin({ provider: "claude", cliPath: "claude", dir: "/tmp/x" })).toThrow();
  });
});
