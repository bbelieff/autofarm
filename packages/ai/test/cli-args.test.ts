import { describe, expect, it } from "vitest";
import {
  AiError,
  buildClaudeArgs,
  DEFAULT_CLAUDE_SYSTEM,
  buildCodexArgs,
  buildMuseArgs,
  createProvider,
} from "../src/index";
import type { RunCli, RunCliOpts, RunCliResult } from "../src/index";

interface CliCall {
  cmd: string;
  args: string[];
  opts: RunCliOpts;
}

function fakeRunCli(res: RunCliResult): RunCli & { calls: CliCall[] } {
  const calls: CliCall[] = [];
  const fn = async (
    cmd: string,
    args: string[],
    opts: RunCliOpts,
  ): Promise<RunCliResult> => {
    calls.push({ cmd, args, opts });
    return res;
  };
  return Object.assign(fn, { calls });
}

const ok = (stdout: string, stderr = ""): RunCliResult => ({
  code: 0,
  stdout,
  stderr,
});

describe("buildClaudeArgs", () => {
  it("exact array with effort and system", () => {
    expect(
      buildClaudeArgs({
        model: "claude-opus-5-5",
        effort: "high",
        system: "sys",
        prompt: "hi",
      }),
    ).toEqual([
      "-p",
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--system-prompt",
      "sys",
    ]);
  });

  it("omits effort and uses the default system prompt when absent", () => {
    expect(buildClaudeArgs({ model: "m", prompt: "hi" })).toEqual([
      "-p",
      "--model",
      "m",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--system-prompt",
      DEFAULT_CLAUDE_SYSTEM,
    ]);
  });
});

describe("buildCodexArgs", () => {
  it("exact array with effort", () => {
    expect(
      buildCodexArgs({ model: "gpt-6-sol", effort: "medium", prompt: "hi" }),
    ).toEqual([
      "exec",
      "--model",
      "gpt-6-sol",
      "-c",
      'model_reasoning_effort="medium"',
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "-",
    ]);
  });

  it("omits -c when no effort", () => {
    expect(buildCodexArgs({ model: "gpt-6-sol", prompt: "hi" })).toEqual([
      "exec",
      "--model",
      "gpt-6-sol",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "-",
    ]);
  });
});

describe("buildMuseArgs", () => {
  it("exact array with effort", () => {
    expect(
      buildMuseArgs({ model: "muse-spark-1.3", effort: "low", prompt: "hi" }),
    ).toEqual([
      "exec",
      "--model",
      "muse-spark-1.3",
      "--reasoning-effort",
      "low",
      "--json",
      "--disable-write",
      "--disable-shell",
      "--disable-web-tools",
      "--no-foreign-personal-context",
      "--no-session-log",
      "--max-model-steps",
      "4",
    ]);
  });

  it("omits --reasoning-effort when no effort", () => {
    expect(buildMuseArgs({ model: "m", prompt: "hi" })).toEqual([
      "exec",
      "--model",
      "m",
      "--json",
      "--disable-write",
      "--disable-shell",
      "--disable-web-tools",
      "--no-foreign-personal-context",
      "--no-session-log",
      "--max-model-steps",
      "4",
    ]);
  });
});

describe("claude subscription generate", () => {
  it("parses result JSON incl. cache tokens, prompt via stdin", async () => {
    const runCli = fakeRunCli(
      ok(
        JSON.stringify({
          result: "hello",
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
          },
        }),
      ),
    );
    const p = createProvider(
      { provider: "claude", mode: "subscription" },
      { runCli },
    );
    const r = await p.generate({ model: "claude-opus-5-5", prompt: "p" });
    expect(r.text).toBe("hello");
    expect(r.usage).toEqual({ inputTokens: 160, outputTokens: 4 });
    expect(r.effort).toBeNull();
    expect(runCli.calls).toHaveLength(1);
    expect(runCli.calls[0]?.cmd).toBe("claude");
    expect(runCli.calls[0]?.opts.input).toBe("p");
  });

  it("is_error true -> cli_failed", async () => {
    const runCli = fakeRunCli(
      ok(JSON.stringify({ is_error: true, result: "boom detail" })),
    );
    const p = createProvider(
      { provider: "claude", mode: "subscription" },
      { runCli },
    );
    await expect(p.generate({ model: "m", prompt: "p" })).rejects.toMatchObject({
      name: "AiError",
      kind: "cli_failed",
    });
  });

  it("invalid JSON -> bad_response", async () => {
    const runCli = fakeRunCli(ok("not json{{"));
    const p = createProvider(
      { provider: "claude", mode: "subscription" },
      { runCli },
    );
    try {
      await p.generate({ model: "m", prompt: "p" });
      expect.unreachable();
    } catch (err) {
      expect((err as AiError).kind).toBe("bad_response");
    }
  });
});

describe("codex subscription generate", () => {
  const jsonl = [
    JSON.stringify({ type: "thread.started", thread_id: "t" }),
    "not-json-line",
    JSON.stringify({
      type: "item.completed",
      item: { type: "reasoning", text: "thinking" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "first" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "final answer" },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 7, output_tokens: 3 },
    }),
  ].join("\n");

  it("takes last agent_message, ignores unknown events, reads usage", async () => {
    const runCli = fakeRunCli(ok(jsonl));
    const p = createProvider(
      { provider: "codex", mode: "subscription" },
      { runCli },
    );
    const r = await p.generate({
      model: "gpt-6-sol",
      effort: "high",
      prompt: "do it",
    });
    expect(r.text).toBe("final answer");
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(r.effort).toBe("high");
    expect(runCli.calls[0]?.cmd).toBe("codex");
    expect(runCli.calls[0]?.opts.input).toBe("do it");
  });

  it("prepends system to the stdin prompt", async () => {
    const runCli = fakeRunCli(
      ok(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "x" },
        }),
      ),
    );
    const p = createProvider(
      { provider: "codex", mode: "subscription" },
      { runCli },
    );
    await p.generate({ model: "m", system: "SYS", prompt: "P" });
    expect(runCli.calls[0]?.opts.input).toBe("System:\nSYS\n\nP");
  });
});

describe("muse subscription generate", () => {
  it("extracts text from common shapes, usage null with reason, strips META_API_KEY", async () => {
    const runCli = fakeRunCli(
      ok(
        [
          JSON.stringify({ type: "log", message: "starting" }),
          JSON.stringify({ type: "delta", data: { text: "mid" } }),
          JSON.stringify({ type: "result", content: "done text" }),
        ].join("\n"),
      ),
    );
    const p = createProvider(
      {
        provider: "muse",
        mode: "subscription",
        env: { META_API_KEY: "super-secret", OTHER: "kept" },
      },
      { runCli },
    );
    const r = await p.generate({ model: "muse-spark-1.3", prompt: "p" });
    expect(r.text).toBe("done text");
    expect(r.usage).toBeNull();
    expect(r.usageReason).toBe("cli does not expose tokens");
    const env = runCli.calls[0]?.opts.env ?? {};
    expect(env["META_API_KEY"]).toBeUndefined();
    expect(env["OTHER"]).toBe("kept");
  });

  it("also finds message-shaped events", async () => {
    const runCli = fakeRunCli(
      ok(JSON.stringify({ message: { content: "msg content" } })),
    );
    const p = createProvider(
      { provider: "muse", mode: "subscription" },
      { runCli },
    );
    const r = await p.generate({ model: "m", prompt: "p" });
    expect(r.text).toBe("msg content");
  });

  it("honors cliPrefix (e.g. WSL)", async () => {
    const runCli = fakeRunCli(ok(JSON.stringify({ text: "t" })));
    const p = createProvider(
      {
        provider: "muse",
        mode: "subscription",
        cliPrefix: ["wsl", "-d", "OpenClawGateway", "-u", "openclaw", "--"],
      },
      { runCli },
    );
    await p.generate({ model: "muse-spark-1.3", prompt: "p" });
    expect(runCli.calls[0]?.cmd).toBe("wsl");
    expect(runCli.calls[0]?.args.slice(0, 7)).toEqual([
      "-d",
      "OpenClawGateway",
      "-u",
      "openclaw",
      "--",
      "muse",
      "exec",
    ]);
  });
});

describe("non-zero exit", () => {
  it("cli_failed with stderr tail (max 500 chars), no prompt leak", async () => {
    const prompt = "PROMPT-UNIQUE- echoed?";
    const runCli = fakeRunCli({
      code: 1,
      stdout: "",
      stderr: `warn\n${"x".repeat(800)}`,
    });
    const p = createProvider(
      { provider: "claude", mode: "subscription" },
      { runCli },
    );
    try {
      await p.generate({ model: "m", prompt });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      const e = err as AiError;
      expect(e.kind).toBe("cli_failed");
      expect(e.message).not.toContain(prompt);
      const tail = e.message.split(": ").at(-1) ?? "";
      expect(tail.length).toBeLessThanOrEqual(500);
      expect(tail).toBe("x".repeat(500));
    }
  });
});

describe("claude 실패 이유", () => {
  it("stdout JSON 의 401 을 인증 실패로", async () => {
    const run = fakeRunCli({ code: 1, stdout: JSON.stringify({ is_error: true, result: "Failed to authenticate. API Error: 401 OAuth access token is invalid.", api_error_status: 401 }), stderr: "" });
    const p = createProvider({ provider: "claude", mode: "subscription" }, { runCli: run });
    await expect(p.generate({ model: "haiku", prompt: "x" })).rejects.toMatchObject({ kind: "auth" });
  });
});
