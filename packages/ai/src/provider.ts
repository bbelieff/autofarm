import { readFile as fsReadFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TIMEOUT_MS,
  MUSE_USAGE_REASON,
  generateClaudeApi,
  generateCodexApi,
  generateGeminiApi,
  generateMuseApi,
  listClaudeApiModels,
  listCodexApiModels,
  listGeminiApiModels,
  listMuseApiModels,
} from "./api";
import type { ApiCallCtx, PartialResult } from "./api";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildMuseArgs,
  defaultRunCli,
  errorMessage,
  isAbortError,
  parseClaudeStdout,
  parseCodexJsonl,
  parseMuseJsonl,
  stderrTail,
} from "./cli";
import { STATIC_MODELS, isEffort } from "./models";
import { AiError } from "./types";
import type {
  AiProvider,
  AuthMode,
  Deps,
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  ProviderConfig,
  ProviderId,
  UsageRecord,
} from "./types";

export function isSupported(provider: ProviderId, mode: AuthMode): boolean {
  return !(provider === "gemini" && mode === "subscription");
}

const DEFAULT_CLI: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  muse: "muse",
};

function cliCommand(
  cfg: ProviderConfig,
  builtArgs: string[],
): { cmd: string; args: string[] } {
  const bin = cfg.cliPath ?? DEFAULT_CLI[cfg.provider] ?? cfg.provider;
  const prefix = cfg.cliPrefix;
  if (prefix && prefix.length > 0) {
    const [first, ...rest] = prefix;
    if (first === undefined || first === "") {
      throw new AiError("cliPrefix must not start with an empty string", "config");
    }
    return { cmd: first, args: [...rest, bin, ...builtArgs] };
  }
  return { cmd: bin, args: builtArgs };
}

/** process.env merged with cfg.env; META_API_KEY removed for muse subscription. */
function subscriptionEnv(
  cfg: ProviderConfig,
  provider: ProviderId,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") {
      env[k] = v;
    }
  }
  if (cfg.env) {
    for (const [k, v] of Object.entries(cfg.env)) {
      env[k] = v;
    }
  }
  if (provider === "muse") {
    delete env["META_API_KEY"];
  }
  return env;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === "object" && v !== null) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

interface ResolvedDeps {
  fetchFn: typeof fetch;
  runCli: NonNullable<Deps["runCli"]>;
  now: () => number;
  readFile: (path: string) => Promise<string>;
  onUsage?: (r: UsageRecord) => void;
}

/** `~/.codex/models_cache.json` -> ModelInfo[] (source "cli-cache"). */
async function listCodexCacheModels(
  cfg: ProviderConfig,
  readFile: (path: string) => Promise<string>,
): Promise<ModelInfo[]> {
  try {
    const home = cfg.env?.["CODEX_HOME"];
    const file =
      home !== undefined && home !== ""
        ? join(home, "models_cache.json")
        : join(homedir(), ".codex", "models_cache.json");
    const raw = await readFile(file);
    const models = asRecord(JSON.parse(raw) as unknown)?.["models"];
    if (!Array.isArray(models)) {
      return STATIC_MODELS.codex;
    }
    const out: ModelInfo[] = [];
    for (const m of models) {
      const mr = asRecord(m);
      const slug = mr?.["slug"];
      if (typeof slug !== "string" || slug === "") {
        continue;
      }
      const levels = mr?.["supported_reasoning_levels"];
      const efforts: ModelInfo["efforts"] = [];
      if (Array.isArray(levels)) {
        for (const lv of levels) {
          const effort = asRecord(lv)?.["effort"];
          if (isEffort(effort) && !efforts.includes(effort)) {
            efforts.push(effort);
          }
        }
      }
      const label = mr?.["display_name"];
      const def = mr?.["default_reasoning_level"];
      const info: ModelInfo = {
        id: slug,
        label: typeof label === "string" && label !== "" ? label : slug,
        efforts,
        hidden: mr?.["visibility"] === "hide",
        source: "cli-cache",
      };
      if (isEffort(def)) {
        info.defaultEffort = def;
      }
      out.push(info);
    }
    return out.length > 0 ? out : STATIC_MODELS.codex;
  } catch {
    return STATIC_MODELS.codex;
  }
}

export function createProvider(cfg: ProviderConfig, deps?: Deps): AiProvider {
  const { provider, mode } = cfg;
  if (!isSupported(provider, mode)) {
    throw new AiError(
      `provider "${provider}" does not support "${mode}" mode`,
      "unsupported",
    );
  }
  if (mode === "api" && !cfg.apiKey) {
    throw new AiError(
      `apiKey is required for ${provider} api mode`,
      "config",
    );
  }
  if (provider === "muse" && mode === "api" && !cfg.baseUrl) {
    throw new AiError("baseUrl is required for muse api mode", "config");
  }

  const resolved: ResolvedDeps = {
    fetchFn: deps?.fetch ?? globalThis.fetch,
    runCli: deps?.runCli ?? defaultRunCli,
    now: deps?.now ?? Date.now,
    readFile: deps?.readFile ?? ((p: string) => fsReadFile(p, "utf8")),
    onUsage: deps?.onUsage,
  };

  async function runSubscription(req: GenerateRequest): Promise<PartialResult> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (req.signal?.aborted === true) {
      throw new AiError(`${provider} request was already aborted`, "timeout");
    }
    let built: string[];
    if (provider === "claude") {
      built = buildClaudeArgs(req);
    } else if (provider === "codex") {
      built = buildCodexArgs(req);
    } else {
      built = buildMuseArgs(req);
    }
    const { cmd, args } = cliCommand(cfg, built);
    const env = subscriptionEnv(cfg, provider);
    // codex has no --system-prompt flag: prepend system to the stdin prompt.
    const input =
      provider === "codex" && req.system !== undefined
        ? `System:\n${req.system}\n\n${req.prompt}`
        : req.prompt;

    const ctrl = new AbortController();
    const onAbort = (): void => {
      try {
        ctrl.abort();
      } catch {
        /* ignore */
      }
    };
    req.signal?.addEventListener("abort", onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onAbort();
        reject(
          new AiError(`${provider} cli timeout after ${timeoutMs}ms`, "timeout"),
        );
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        resolved.runCli(cmd, args, {
          input,
          timeoutMs,
          env,
          signal: ctrl.signal,
        }),
        timeoutP,
      ]);
      if (res.code !== 0) {
        // Claude 는 실패해도 stdout JSON 에 이유(result)와 API 상태 코드를 담는다
        if (provider === "claude") {
          try {
            const j = JSON.parse(res.stdout) as { result?: unknown; api_error_status?: unknown };
            if (typeof j.result === "string" && j.result) {
              const status = typeof j.api_error_status === "number" ? j.api_error_status : undefined;
              throw new AiError(j.result.slice(0, 300), status === 401 || status === 403 ? "auth" : status === 429 ? "rate_limited" : "cli_failed", status);
            }
          } catch (e) {
            if (e instanceof AiError) throw e;
          }
        }
        throw new AiError(
          `${provider} cli failed (exit ${res.code}): ${stderrTail(res.stderr)}`,
          "cli_failed",
        );
      }
      if (provider === "claude") {
        const parsed = parseClaudeStdout(res.stdout);
        return {
          text: parsed.text,
          provider,
          mode,
          model: req.model,
          effort: req.effort ?? null,
          usage: parsed.usage,
        };
      }
      if (provider === "codex") {
        const parsed = parseCodexJsonl(res.stdout);
        return {
          text: parsed.text,
          provider,
          mode,
          model: req.model,
          effort: req.effort ?? null,
          usage: parsed.usage,
        };
      }
      const parsed = parseMuseJsonl(res.stdout);
      return {
        text: parsed.text,
        provider,
        mode,
        model: req.model,
        effort: req.effort ?? null,
        usage: parsed.usage,
        usageReason: MUSE_USAGE_REASON,
      };
    } catch (err) {
      if (err instanceof AiError) {
        throw err;
      }
      if (ctrl.signal.aborted || isAbortError(err)) {
        throw new AiError(`${provider} cli timed out`, "timeout");
      }
      throw new AiError(
        `${provider} cli failed: ${errorMessage(err)}`,
        "cli_failed",
      );
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      req.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function runApi(req: GenerateRequest): Promise<PartialResult> {
    const ctx: ApiCallCtx = {
      // Validated above: api mode always has an apiKey.
      apiKey: cfg.apiKey as string,
      baseUrl: cfg.baseUrl,
      fetchFn: resolved.fetchFn,
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: req.signal,
    };
    if (provider === "claude") {
      return generateClaudeApi(ctx, req);
    }
    if (provider === "codex") {
      return generateCodexApi(ctx, req);
    }
    if (provider === "muse") {
      return generateMuseApi(ctx, req);
    }
    return generateGeminiApi(ctx, req);
  }

  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    const { now, onUsage } = resolved;
    const start = now();
    try {
      const partial =
        mode === "subscription" ? await runSubscription(req) : await runApi(req);
      const elapsedMs = now() - start;
      const result: GenerateResult = { ...partial, elapsedMs };
      onUsage?.({
        provider,
        mode,
        model: req.model,
        effort: partial.effort,
        usage: partial.usage,
        usageReason: partial.usageReason,
        elapsedMs,
        ok: true,
        purpose: req.purpose,
        at: new Date(now()),
      });
      return result;
    } catch (err) {
      const elapsedMs = now() - start;
      const aiErr =
        err instanceof AiError
          ? err
          : new AiError(`generate failed: ${errorMessage(err)}`, "bad_response");
      onUsage?.({
        provider,
        mode,
        model: req.model,
        effort: req.effort ?? null,
        usage: null,
        elapsedMs,
        ok: false,
        errorKind: aiErr.kind,
        purpose: req.purpose,
        at: new Date(now()),
      });
      throw aiErr;
    }
  }

  async function listModels(): Promise<ModelInfo[]> {
    if (mode === "subscription") {
      if (provider === "codex") {
        return listCodexCacheModels(cfg, resolved.readFile);
      }
      return STATIC_MODELS[provider];
    }
    const ctx: ApiCallCtx = {
      apiKey: cfg.apiKey as string,
      baseUrl: cfg.baseUrl,
      fetchFn: resolved.fetchFn,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
    if (provider === "claude") {
      return listClaudeApiModels(ctx);
    }
    if (provider === "codex") {
      return listCodexApiModels(ctx);
    }
    if (provider === "muse") {
      try {
        return await listMuseApiModels(ctx);
      } catch {
        return STATIC_MODELS.muse;
      }
    }
    return listGeminiApiModels(ctx);
  }

  return { id: provider, mode, generate, listModels };
}

export interface MeterSummary {
  provider: ProviderId;
  mode: AuthMode;
  model: string;
  calls: number;
  ok: number;
  inputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number;
}

export interface UsageMeter {
  record(r: UsageRecord): void;
  summary(): MeterSummary[];
}

/**
 * In-memory usage aggregation. Token sums stay null for a group when any
 * record in that group had null usage — never estimated.
 */
export function createUsageMeter(): UsageMeter {
  interface Group {
    provider: ProviderId;
    mode: AuthMode;
    model: string;
    calls: number;
    ok: number;
    inputSum: number;
    outputSum: number;
    inputNull: boolean;
    outputNull: boolean;
    elapsedMs: number;
  }
  const groups = new Map<string, Group>();
  return {
    record(r: UsageRecord): void {
      const key = `${r.provider}\u0000${r.mode}\u0000${r.model}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          provider: r.provider,
          mode: r.mode,
          model: r.model,
          calls: 0,
          ok: 0,
          inputSum: 0,
          outputSum: 0,
          inputNull: false,
          outputNull: false,
          elapsedMs: 0,
        };
        groups.set(key, g);
      }
      g.calls += 1;
      if (r.ok) {
        g.ok += 1;
      }
      if (r.usage === null || r.usage.inputTokens === null) {
        g.inputNull = true;
      } else {
        g.inputSum += r.usage.inputTokens;
      }
      if (r.usage === null || r.usage.outputTokens === null) {
        g.outputNull = true;
      } else {
        g.outputSum += r.usage.outputTokens;
      }
      g.elapsedMs += r.elapsedMs;
    },
    summary(): MeterSummary[] {
      return [...groups.values()].map((g) => ({
        provider: g.provider,
        mode: g.mode,
        model: g.model,
        calls: g.calls,
        ok: g.ok,
        inputTokens: g.inputNull ? null : g.inputSum,
        outputTokens: g.outputNull ? null : g.outputSum,
        elapsedMs: g.elapsedMs,
      }));
    },
  };
}
