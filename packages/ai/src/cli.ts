import { spawn } from "node:child_process";
import { AiError } from "./types";
import type {
  GenerateRequest,
  RunCli,
  RunCliOpts,
  RunCliResult,
  Usage,
} from "./types";

/** Pure: argv for `claude -p` headless run. Prompt goes via stdin. */
export const DEFAULT_CLAUDE_SYSTEM = "You are a concise, accurate assistant.";

export function buildClaudeArgs(req: GenerateRequest): string[] {
  const args: string[] = ["-p", "--model", req.model];
  if (req.effort !== undefined) {
    args.push("--effort", req.effort);
  }
  // 이 컴퓨터의 개인 설정(CLAUDE.md·훅·MCP)을 싣지 않는다. --bare 는 구독 로그인도 끄므로 쓰지 않는다.
  args.push("--output-format", "json", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config");
  args.push("--system-prompt", req.system ?? DEFAULT_CLAUDE_SYSTEM);
  return args;
}

/** Pure: argv for `codex exec` headless run. Prompt goes via stdin. */
export function buildCodexArgs(req: GenerateRequest): string[] {
  const args: string[] = ["exec", "--model", req.model];
  if (req.effort !== undefined) {
    args.push("-c", `model_reasoning_effort="${req.effort}"`);
  }
  args.push(
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "-",
  );
  return args;
}

/** Pure: argv for `muse exec` headless run. Prompt goes via stdin. */
export function buildMuseArgs(req: GenerateRequest): string[] {
  const args: string[] = ["exec", "--model", req.model];
  if (req.effort !== undefined) {
    args.push("--reasoning-effort", req.effort);
  }
  args.push(
    "--json",
    "--disable-write",
    "--disable-shell",
    "--disable-web-tools",
    "--no-foreign-personal-context",
    "--no-session-log",
    "--max-model-steps",
    "4",
  );
  return args;
}

/**
 * Default CLI runner: spawn with no shell, prompt via stdin,
 * kill on timeout or abort. Never logs the prompt.
 */
export const defaultRunCli: RunCli = (
  cmd: string,
  args: string[],
  opts: RunCliOpts,
): Promise<RunCliResult> => {
  return new Promise<RunCliResult>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        env: (opts.env ?? process.env) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      fail(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      const err = new Error(`cli timeout after ${opts.timeoutMs}ms: ${cmd}`);
      (err as { code?: string }).code = "ETIMEOUT";
      fail(err);
    }, opts.timeoutMs);
    if (opts.signal?.aborted === true) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      const err = new Error("cli aborted before start");
      (err as { code?: string }).code = "EABORT";
      fail(err);
      return;
    }
    opts.signal?.addEventListener(
      "abort",
      () => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        const err = new Error("cli aborted");
        (err as { code?: string }).code = "EABORT";
        fail(err);
      },
      { once: true },
    );
    const out = child.stdout;
    const errOut = child.stderr;
    const input = child.stdin;
    if (!out || !errOut || !input) {
      fail(new Error("cli stdio pipes unavailable"));
      return;
    }
    out.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    errOut.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err: Error) => {
      fail(err);
    });
    child.on("close", (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
    try {
      if (opts.input !== undefined) {
        input.write(opts.input);
      }
      input.end();
    } catch (err) {
      fail(err);
    }
  });
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === "object" && v !== null) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Keep only the tail and redact anything that looks like a secret. */
function redactSecrets(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/(api[_-]?key\s*[:=]\s*)(\S+)/gi, "$1[redacted]")
    .replace(/(bearer\s+)(\S+)/gi, "$1[redacted]");
}

/** Last 500 chars of stderr, trimmed and secret-redacted. Never includes the prompt. */
export function stderrTail(stderr: string): string {
  return redactSecrets(stderr.trim().slice(-500));
}

export interface ParsedCliOutput {
  text: string;
  usage: Usage | null;
}

/** Parse `claude -p --output-format json` stdout. */
export function parseClaudeStdout(stdout: string): ParsedCliOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new AiError("claude cli produced invalid JSON", "bad_response");
  }
  const r = asRecord(parsed);
  if (!r) {
    throw new AiError("claude cli produced unexpected JSON shape", "bad_response");
  }
  if (r["is_error"] === true) {
    const detail = typeof r["result"] === "string" && r["result"] !== "" ? `: ${r["result"].slice(0, 500)}` : "";
    throw new AiError(`claude cli reported an error${detail}`, "cli_failed");
  }
  const text = r["result"];
  if (typeof text !== "string") {
    throw new AiError("claude cli output has no result text", "bad_response");
  }
  let usage: Usage | null = null;
  const u = asRecord(r["usage"]);
  if (u) {
    const base = asNumber(u["input_tokens"]);
    const cacheCreate = asNumber(u["cache_creation_input_tokens"]) ?? 0;
    const cacheRead = asNumber(u["cache_read_input_tokens"]) ?? 0;
    const input =
      base === undefined && cacheCreate === 0 && cacheRead === 0
        ? null
        : (base ?? 0) + cacheCreate + cacheRead;
    usage = {
      inputTokens: input,
      outputTokens: asNumber(u["output_tokens"]) ?? null,
    };
  }
  return { text, usage };
}

/** Parse `codex exec --json` JSONL stdout. Tolerant of unknown event types. */
export function parseCodexJsonl(stdout: string): ParsedCliOutput {
  let text: string | undefined;
  let usage: Usage | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let ev: unknown;
    try {
      ev = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    const r = asRecord(ev);
    if (!r) {
      continue;
    }
    if (r["type"] === "item.completed") {
      const item = asRecord(r["item"]);
      if (item?.["type"] === "agent_message") {
        const t = item["text"];
        if (typeof t === "string" && t !== "") {
          text = t;
        }
      }
    } else if (r["type"] === "turn.completed") {
      const u = asRecord(r["usage"]);
      if (u) {
        usage = {
          inputTokens: asNumber(u["input_tokens"]) ?? null,
          outputTokens: asNumber(u["output_tokens"]) ?? null,
        };
      }
    }
  }
  if (text === undefined) {
    throw new AiError("codex cli produced no agent message", "bad_response");
  }
  return { text, usage };
}

const MUSE_TEXT_KEYS = ["text", "message", "content"] as const;
const MUSE_NESTED_KEYS = [
  "item",
  "data",
  "delta",
  "payload",
  "result",
  "output",
  "response",
] as const;

function joinTextParts(v: unknown): string | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item !== "") {
      parts.push(item);
      continue;
    }
    const ir = asRecord(item);
    const t = ir?.["text"];
    if (typeof t === "string" && t !== "") {
      parts.push(t);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

/** Best-effort text extraction from one undocumented muse JSONL event. */
export function extractMuseEventText(ev: unknown): string | undefined {
  if (typeof ev === "string") {
    return ev !== "" ? ev : undefined;
  }
  const r = asRecord(ev);
  if (!r) {
    return undefined;
  }
  for (const k of MUSE_TEXT_KEYS) {
    const v: unknown = r[k];
    if (typeof v === "string" && v !== "") {
      return v;
    }
    const joined = joinTextParts(v);
    if (joined !== undefined) {
      return joined;
    }
    if (k === "message") {
      const mr = asRecord(v);
      if (mr) {
        for (const nk of ["content", "text"] as const) {
          const nv: unknown = mr[nk];
          if (typeof nv === "string" && nv !== "") {
            return nv;
          }
        }
      }
    }
  }
  for (const k of MUSE_NESTED_KEYS) {
    const vr = asRecord(r[k]);
    if (!vr) {
      continue;
    }
    for (const tk of MUSE_TEXT_KEYS) {
      const t: unknown = vr[tk];
      if (typeof t === "string" && t !== "") {
        return t;
      }
    }
  }
  return undefined;
}

/**
 * Parse `muse exec --json` JSONL stdout. The format is undocumented:
 * take the last event carrying a string `text`/`message`/`content` field.
 * The CLI does not expose token counts.
 */
export function parseMuseJsonl(stdout: string): ParsedCliOutput {
  let text: string | undefined;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let ev: unknown;
    try {
      ev = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    const found = extractMuseEventText(ev);
    if (found !== undefined) {
      text = found;
    }
  }
  if (text === undefined) {
    throw new AiError("muse cli produced no text event", "bad_response");
  }
  return { text, usage: null };
}

/** True for AbortError-style failures from fetch/runCli. */
export function isAbortError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  const r = e as { name?: unknown; code?: unknown; message?: unknown };
  if (r.name === "AbortError" || r.code === "EABORT" || r.code === "ETIMEOUT") {
    return true;
  }
  return (
    typeof r.message === "string" && /abort|timed?\s*out/i.test(r.message)
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
