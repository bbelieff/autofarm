import { CLAUDE_EFFORTS, CODEX_API_EFFORTS, MUSE_EFFORTS } from "./models";
import { AiError } from "./types";
import type {
  GenerateRequest,
  GenerateResult,
  ModelInfo,
  Usage,
} from "./types";
import { errorMessage, isAbortError } from "./cli";

export const DEFAULT_TIMEOUT_MS = 120000;
export const MUSE_USAGE_REASON = "cli does not expose tokens";

export interface ApiCallCtx {
  apiKey: string;
  baseUrl?: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type PartialResult = Omit<GenerateResult, "elapsedMs">;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === "object" && v !== null) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function statusError(
  provider: string,
  status: number,
  bodyText: string,
): AiError {
  if (status === 401 || status === 403) {
    return new AiError(
      `${provider} api auth failed (status ${status})`,
      "auth",
      status,
    );
  }
  if (status === 429) {
    return new AiError(`${provider} api rate limited`, "rate_limited", status);
  }
  return new AiError(
    `${provider} api error ${status}: ${bodyText.slice(0, 200)}`,
    "bad_response",
    status,
  );
}

async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function readBodyJson(res: Response, provider: string): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new AiError(
      `${provider} api returned an unreadable body: ${errorMessage(err)}`,
      "bad_response",
      res.status,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiError(
      `${provider} api returned invalid JSON`,
      "bad_response",
      res.status,
    );
  }
}

/**
 * fetch with an internal timeout. The timer aborts the request so even
 * fake fetch implementations that "wait on abort" resolve promptly;
 * a race guards against implementations that ignore the signal.
 */
export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const onOuterAbort = (): void => {
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  };
  if (outerSignal?.aborted === true) {
    ctrl.abort();
  } else {
    outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onOuterAbort();
      reject(new AiError(`request timeout after ${timeoutMs}ms: ${url}`, "timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchFn(url, { ...init, signal: ctrl.signal }),
      timeoutP,
    ]);
  } catch (err) {
    if (err instanceof AiError) {
      throw err;
    }
    if (ctrl.signal.aborted || isAbortError(err)) {
      throw new AiError(`request to ${url} timed out`, "timeout");
    }
    throw new AiError(
      `request to ${url} failed: ${errorMessage(err)}`,
      "bad_response",
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

async function postJson(
  ctx: ApiCallCtx,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetchWithTimeout(
    ctx.fetchFn,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    ctx.timeoutMs,
    ctx.signal,
  );
  if (!res.ok) {
    throw statusError(provider, res.status, await readBodyText(res));
  }
  return readBodyJson(res, provider);
}

async function getJson(
  ctx: ApiCallCtx,
  provider: string,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await fetchWithTimeout(
    ctx.fetchFn,
    url,
    { method: "GET", headers },
    ctx.timeoutMs,
    ctx.signal,
  );
  if (!res.ok) {
    throw statusError(provider, res.status, await readBodyText(res));
  }
  return readBodyJson(res, provider);
}

const ANTHROPIC_BASE = "https://api.anthropic.com";
const OPENAI_BASE = "https://api.openai.com";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

/* ---------------- Claude (Anthropic Messages API) ---------------- */

export async function generateClaudeApi(
  ctx: ApiCallCtx,
  req: GenerateRequest,
): Promise<PartialResult> {
  const base = ctx.baseUrl ?? ANTHROPIC_BASE;
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxOutputTokens ?? 2048,
    messages: [{ role: "user", content: req.prompt }],
  };
  if (req.system !== undefined) {
    body["system"] = req.system;
  }
  const parsed = await postJson(ctx, "claude", `${base}/v1/messages`, {
    "x-api-key": ctx.apiKey,
    "anthropic-version": "2023-06-01",
  }, body);
  const r = asRecord(parsed);
  const content = r?.["content"];
  if (!Array.isArray(content)) {
    throw new AiError("claude api response has no content", "bad_response");
  }
  const texts: string[] = [];
  for (const block of content) {
    const b = asRecord(block);
    if (b?.["type"] === "text" && typeof b["text"] === "string") {
      texts.push(b["text"]);
    }
  }
  const u = asRecord(r?.["usage"]);
  return {
    text: texts.join(""),
    provider: "claude",
    mode: "api",
    model: req.model,
    effort: req.effort ?? null,
    usage: {
      inputTokens: u ? (asNumber(u["input_tokens"]) ?? null) : null,
      outputTokens: u ? (asNumber(u["output_tokens"]) ?? null) : null,
    },
  };
}

export async function listClaudeApiModels(ctx: ApiCallCtx): Promise<ModelInfo[]> {
  const base = ctx.baseUrl ?? ANTHROPIC_BASE;
  const parsed = await getJson(ctx, "claude", `${base}/v1/models`, {
    "x-api-key": ctx.apiKey,
    "anthropic-version": "2023-06-01",
  });
  const data = asRecord(parsed)?.["data"];
  if (!Array.isArray(data)) {
    throw new AiError("claude api models response has no data", "bad_response");
  }
  const out: ModelInfo[] = [];
  for (const m of data) {
    const mr = asRecord(m);
    const id = mr?.["id"];
    if (typeof id === "string" && id !== "") {
      out.push({
        id,
        label: typeof mr?.["display_name"] === "string" ? mr["display_name"] : id,
        efforts: [...CLAUDE_EFFORTS],
        source: "api",
      });
    }
  }
  return out;
}

/* ---------------- Codex (OpenAI Responses API) ---------------- */

export async function generateCodexApi(
  ctx: ApiCallCtx,
  req: GenerateRequest,
): Promise<PartialResult> {
  const base = ctx.baseUrl ?? OPENAI_BASE;
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.prompt,
  };
  if (req.system !== undefined) {
    body["instructions"] = req.system;
  }
  if (req.effort !== undefined) {
    body["reasoning"] = { effort: req.effort };
  }
  if (req.maxOutputTokens !== undefined) {
    body["max_output_tokens"] = req.maxOutputTokens;
  }
  const parsed = await postJson(ctx, "codex", `${base}/v1/responses`, {
    authorization: `Bearer ${ctx.apiKey}`,
  }, body);
  const r = asRecord(parsed);
  if (!r) {
    throw new AiError("codex api returned unexpected shape", "bad_response");
  }
  let text: string | undefined;
  if (typeof r["output_text"] === "string") {
    text = r["output_text"];
  } else {
    const output = r["output"];
    if (!Array.isArray(output)) {
      throw new AiError("codex api response has no output", "bad_response");
    }
    const parts: string[] = [];
    for (const item of output) {
      const content = asRecord(item)?.["content"];
      if (!Array.isArray(content)) {
        continue;
      }
      for (const c of content) {
        const cr = asRecord(c);
        if (typeof cr?.["text"] === "string") {
          parts.push(cr["text"]);
        }
      }
    }
    text = parts.join("");
  }
  const u = asRecord(r["usage"]);
  return {
    text,
    provider: "codex",
    mode: "api",
    model: req.model,
    effort: req.effort ?? null,
    usage: {
      inputTokens: u ? (asNumber(u["input_tokens"]) ?? null) : null,
      outputTokens: u ? (asNumber(u["output_tokens"]) ?? null) : null,
    },
  };
}

export async function listCodexApiModels(ctx: ApiCallCtx): Promise<ModelInfo[]> {
  const base = ctx.baseUrl ?? OPENAI_BASE;
  const parsed = await getJson(ctx, "codex", `${base}/v1/models`, {
    authorization: `Bearer ${ctx.apiKey}`,
  });
  const data = asRecord(parsed)?.["data"];
  if (!Array.isArray(data)) {
    throw new AiError("codex api models response has no data", "bad_response");
  }
  const out: ModelInfo[] = [];
  for (const m of data) {
    const mr = asRecord(m);
    const id = mr?.["id"];
    if (typeof id === "string" && id !== "") {
      out.push({ id, label: id, efforts: [...CODEX_API_EFFORTS], source: "api" });
    }
  }
  return out;
}

/* ---------------- Muse Spark (Meta Model API, UNVERIFIED) ---------------- */

export async function generateMuseApi(
  ctx: ApiCallCtx,
  req: GenerateRequest,
): Promise<PartialResult> {
  if (!ctx.baseUrl) {
    throw new AiError("baseUrl is required for muse api mode", "config");
  }
  const messages: Array<Record<string, string>> = [];
  if (req.system !== undefined) {
    messages.push({ role: "system", content: req.system });
  }
  messages.push({ role: "user", content: req.prompt });
  const body: Record<string, unknown> = { model: req.model, messages };
  if (req.effort !== undefined) {
    body["reasoning_effort"] = req.effort;
  }
  if (req.maxOutputTokens !== undefined) {
    body["max_tokens"] = req.maxOutputTokens;
  }
  const parsed = await postJson(ctx, "muse", `${ctx.baseUrl}/chat/completions`, {
    authorization: `Bearer ${ctx.apiKey}`,
  }, body);
  const choices = asRecord(parsed)?.["choices"];
  const first = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const content = asRecord(first?.["message"])?.["content"];
  if (typeof content !== "string") {
    throw new AiError("muse api response has no message content", "bad_response");
  }
  const u = asRecord(asRecord(parsed)?.["usage"]);
  return {
    text: content,
    provider: "muse",
    mode: "api",
    model: req.model,
    effort: req.effort ?? null,
    usage: {
      inputTokens: u ? (asNumber(u["prompt_tokens"]) ?? null) : null,
      outputTokens: u ? (asNumber(u["completion_tokens"]) ?? null) : null,
    },
  };
}

export async function listMuseApiModels(ctx: ApiCallCtx): Promise<ModelInfo[]> {
  if (!ctx.baseUrl) {
    throw new AiError("baseUrl is required for muse api mode", "config");
  }
  const parsed = await getJson(ctx, "muse", `${ctx.baseUrl}/models`, {
    authorization: `Bearer ${ctx.apiKey}`,
  });
  const data = asRecord(parsed)?.["data"];
  if (!Array.isArray(data)) {
    throw new AiError("muse api models response has no data", "bad_response");
  }
  const out: ModelInfo[] = [];
  for (const m of data) {
    const mr = asRecord(m);
    const id = mr?.["id"];
    if (typeof id === "string" && id !== "") {
      out.push({
        id,
        label: id,
        efforts: [...MUSE_EFFORTS],
        defaultEffort: "high",
        source: "api",
      });
    }
  }
  return out;
}

/* ---------------- Gemini (AI Studio / Vertex) ---------------- */

export async function generateGeminiApi(
  ctx: ApiCallCtx,
  req: GenerateRequest,
): Promise<PartialResult> {
  const base = ctx.baseUrl ?? GEMINI_BASE;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
  };
  if (req.system !== undefined) {
    body["systemInstruction"] = { parts: [{ text: req.system }] };
  }
  if (req.maxOutputTokens !== undefined) {
    body["generationConfig"] = { maxOutputTokens: req.maxOutputTokens };
  }
  const parsed = await postJson(
    ctx,
    "gemini",
    `${base}/v1beta/models/${req.model}:generateContent`,
    { "x-goog-api-key": ctx.apiKey },
    body,
  );
  const candidates = asRecord(parsed)?.["candidates"];
  const first = Array.isArray(candidates) ? asRecord(candidates[0]) : undefined;
  const parts = asRecord(first?.["content"])?.["parts"];
  if (!Array.isArray(parts)) {
    throw new AiError("gemini api response has no content parts", "bad_response");
  }
  const texts: string[] = [];
  for (const p of parts) {
    const t = asRecord(p)?.["text"];
    if (typeof t === "string") {
      texts.push(t);
    }
  }
  const meta = asRecord(asRecord(parsed)?.["usageMetadata"]);
  const usage: Usage = {
    inputTokens: meta ? (asNumber(meta["promptTokenCount"]) ?? null) : null,
    outputTokens: meta ? (asNumber(meta["candidatesTokenCount"]) ?? null) : null,
  };
  return {
    text: texts.join(""),
    provider: "gemini",
    mode: "api",
    model: req.model,
    effort: req.effort ?? null,
    usage,
  };
}

export async function listGeminiApiModels(ctx: ApiCallCtx): Promise<ModelInfo[]> {
  const base = ctx.baseUrl ?? GEMINI_BASE;
  const parsed = await getJson(ctx, "gemini", `${base}/v1beta/models`, {
    "x-goog-api-key": ctx.apiKey,
  });
  const models = asRecord(parsed)?.["models"];
  if (!Array.isArray(models)) {
    throw new AiError("gemini api models response has no models", "bad_response");
  }
  const out: ModelInfo[] = [];
  for (const m of models) {
    const mr = asRecord(m);
    const name = mr?.["name"];
    if (typeof name === "string" && name !== "") {
      const id = name.startsWith("models/") ? name.slice("models/".length) : name;
      out.push({ id, label: id, efforts: [], source: "api" });
    }
  }
  return out;
}
