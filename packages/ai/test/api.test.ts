import { describe, expect, it } from "vitest";
import { AiError, createProvider } from "../src/index";

interface FetchCall {
  url: string;
  init: RequestInit;
}

type FetchFn = typeof fetch;

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): FetchFn & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const merged: RequestInit = init ?? {};
    calls.push({ url, init: merged });
    return handler(url, merged);
  };
  return Object.assign(fn, { calls });
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const text = (data: string, status: number): Response =>
  new Response(data, { status });

/** Never resolves on its own; rejects with AbortError when aborted. */
function hangingFetch(): FetchFn {
  return (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const signal = init?.signal;
    if (signal?.aborted === true) {
      throw new DOMException("aborted", "AbortError");
    }
    await new Promise<void>((_, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
    throw new Error("unreachable");
  }) as FetchFn;
}

function headersOf(init: RequestInit): Record<string, string> {
  const h = new Headers(init.headers);
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("claude api", () => {
  it("posts correct URL/headers/body and parses text+usage", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      return json({
        content: [
          { type: "text", text: "hel" },
          { type: "tool_use", id: "1" },
          { type: "text", text: "lo" },
        ],
        usage: { input_tokens: 11, output_tokens: 5 },
      });
    });
    const p = createProvider(
      { provider: "claude", mode: "api", apiKey: "ak" },
      { fetch },
    );
    const r = await p.generate({
      model: "claude-sonnet-5-5",
      effort: "low",
      system: "S",
      prompt: "P",
    });
    expect(r.text).toBe("hello");
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 5 });
    expect(r.effort).toBe("low");
    const call = fetch.calls[0];
    expect(call).toBeDefined();
    const headers = headersOf(call?.init ?? {});
    expect(headers["x-api-key"]).toBe("ak");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(bodyOf(call?.init ?? {})).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 2048,
      system: "S",
      messages: [{ role: "user", content: "P" }],
    });
  });

  it("honors baseUrl and maxOutputTokens overrides", async () => {
    const fetch = fakeFetch(() => json({ content: [], usage: {} }));
    const p = createProvider(
      {
        provider: "claude",
        mode: "api",
        apiKey: "ak",
        baseUrl: "https://proxy.example",
      },
      { fetch },
    );
    await p.generate({ model: "m", prompt: "P", maxOutputTokens: 7 });
    expect(fetch.calls[0]?.url).toBe("https://proxy.example/v1/messages");
    const body = bodyOf(fetch.calls[0]?.init ?? {});
    expect(body["max_tokens"]).toBe(7);
    expect(body).not.toHaveProperty("system");
  });

  it("maps 401->auth, 429->rate_limited, 500->bad_response", async () => {
    for (const [status, kind] of [
      [401, "auth"],
      [403, "auth"],
      [429, "rate_limited"],
      [500, "bad_response"],
    ] as const) {
      const fetch = fakeFetch(() => text("err-body", status));
      const p = createProvider(
        { provider: "claude", mode: "api", apiKey: "ak" },
        { fetch },
      );
      try {
        await p.generate({ model: "m", prompt: "P" });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).kind).toBe(kind);
        expect((err as AiError).status).toBe(status);
      }
    }
  });

  it("timeout -> timeout", async () => {
    const p = createProvider(
      { provider: "claude", mode: "api", apiKey: "ak" },
      { fetch: hangingFetch() },
    );
    try {
      await p.generate({ model: "m", prompt: "P", timeoutMs: 30 });
      expect.unreachable();
    } catch (err) {
      expect((err as AiError).kind).toBe("timeout");
    }
  });

  it("listModels maps data[].id with low..max efforts", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe("https://api.anthropic.com/v1/models");
      return json({ data: [{ id: "claude-x" }, { id: "claude-y" }] });
    });
    const p = createProvider(
      { provider: "claude", mode: "api", apiKey: "ak" },
      { fetch },
    );
    const models = await p.listModels();
    expect(models).toEqual([
      {
        id: "claude-x",
        label: "claude-x",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        source: "api",
      },
      {
        id: "claude-y",
        label: "claude-y",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        source: "api",
      },
    ]);
  });
});

describe("codex api", () => {
  it("posts responses body and parses output_text", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      return json({
        output_text: "out",
        usage: { input_tokens: 3, output_tokens: 9 },
      });
    });
    const p = createProvider(
      { provider: "codex", mode: "api", apiKey: "sk" },
      { fetch },
    );
    const r = await p.generate({
      model: "gpt-6-sol",
      effort: "medium",
      system: "S",
      prompt: "P",
      maxOutputTokens: 33,
    });
    expect(r.text).toBe("out");
    expect(r.usage).toEqual({ inputTokens: 3, outputTokens: 9 });
    const call = fetch.calls[0];
    expect(headersOf(call?.init ?? {})["authorization"]).toBe("Bearer sk");
    expect(bodyOf(call?.init ?? {})).toEqual({
      model: "gpt-6-sol",
      input: "P",
      instructions: "S",
      reasoning: { effort: "medium" },
      max_output_tokens: 33,
    });
  });

  it("falls back to joining output[].content[].text", async () => {
    const fetch = fakeFetch(() =>
      json({
        output: [
          { content: [{ text: "a" }, { text: "b" }] },
          { content: "skip" },
        ],
        usage: {},
      }),
    );
    const p = createProvider(
      { provider: "codex", mode: "api", apiKey: "sk" },
      { fetch },
    );
    const r = await p.generate({ model: "m", prompt: "P" });
    expect(r.text).toBe("ab");
    expect(r.usage).toEqual({ inputTokens: null, outputTokens: null });
  });

  it("401 -> auth; listModels hits /v1/models", async () => {
    const bad = fakeFetch(() => text("no", 401));
    const p1 = createProvider(
      { provider: "codex", mode: "api", apiKey: "sk" },
      { fetch: bad },
    );
    await expect(p1.generate({ model: "m", prompt: "P" })).rejects.toMatchObject({
      kind: "auth",
    });
    const list = fakeFetch(() => json({ data: [{ id: "gpt-z" }] }));
    const p2 = createProvider(
      { provider: "codex", mode: "api", apiKey: "sk" },
      { fetch: list },
    );
    const models = await p2.listModels();
    expect(list.calls[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(models[0]?.id).toBe("gpt-z");
    expect(models[0]?.source).toBe("api");
  });
});

describe("muse api (UNVERIFIED Meta Model API)", () => {
  const base = "https://meta-model.example";

  it("posts chat/completions and parses choices+usage", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe(`${base}/chat/completions`);
      return json({
        choices: [{ message: { content: "meta reply" } }],
        usage: { prompt_tokens: 6, completion_tokens: 2 },
      });
    });
    const p = createProvider(
      { provider: "muse", mode: "api", apiKey: "mk", baseUrl: base },
      { fetch },
    );
    const r = await p.generate({
      model: "muse-spark-1.3",
      effort: "high",
      system: "S",
      prompt: "P",
      maxOutputTokens: 11,
    });
    expect(r.text).toBe("meta reply");
    expect(r.usage).toEqual({ inputTokens: 6, outputTokens: 2 });
    const call = fetch.calls[0];
    expect(headersOf(call?.init ?? {})["authorization"]).toBe("Bearer mk");
    expect(bodyOf(call?.init ?? {})).toEqual({
      model: "muse-spark-1.3",
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "P" },
      ],
      reasoning_effort: "high",
      max_tokens: 11,
    });
  });

  it("429 -> rate_limited; listModels falls back to STATIC on error", async () => {
    const limited = fakeFetch(() => text("slow", 429));
    const p1 = createProvider(
      { provider: "muse", mode: "api", apiKey: "mk", baseUrl: base },
      { fetch: limited },
    );
    await expect(
      p1.generate({ model: "m", prompt: "P" }),
    ).rejects.toMatchObject({ kind: "rate_limited" });

    const failing = fakeFetch(() => text("oops", 500));
    const p2 = createProvider(
      { provider: "muse", mode: "api", apiKey: "mk", baseUrl: base },
      { fetch: failing },
    );
    const models = await p2.listModels();
    expect(failing.calls[0]?.url).toBe(`${base}/models`);
    expect(models.map((m) => m.id)).toContain("muse-spark-1.3-contributor");
    expect(models.every((m) => m.source === "static")).toBe(true);
  });
});

describe("gemini api", () => {
  it("posts generateContent and parses candidates+usage", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gem-1:generateContent",
      );
      return json({
        candidates: [
          { content: { parts: [{ text: "g1" }, { text: "g2" }] } },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
      });
    });
    const p = createProvider(
      { provider: "gemini", mode: "api", apiKey: "gk" },
      { fetch },
    );
    const r = await p.generate({
      model: "gem-1",
      system: "S",
      prompt: "P",
      maxOutputTokens: 9,
    });
    expect(r.text).toBe("g1g2");
    expect(r.usage).toEqual({ inputTokens: 8, outputTokens: 4 });
    const call = fetch.calls[0];
    expect(headersOf(call?.init ?? {})["x-goog-api-key"]).toBe("gk");
    expect(bodyOf(call?.init ?? {})).toEqual({
      contents: [{ role: "user", parts: [{ text: "P" }] }],
      systemInstruction: { parts: [{ text: "S" }] },
      generationConfig: { maxOutputTokens: 9 },
    });
  });

  it("timeout -> timeout; listModels strips models/ prefix", async () => {
    const p1 = createProvider(
      { provider: "gemini", mode: "api", apiKey: "gk" },
      { fetch: hangingFetch() },
    );
    try {
      await p1.generate({ model: "m", prompt: "P", timeoutMs: 30 });
      expect.unreachable();
    } catch (err) {
      expect((err as AiError).kind).toBe("timeout");
    }

    const list = fakeFetch((url) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models");
      return json({ models: [{ name: "models/gem-1" }, { name: "gem-2" }] });
    });
    const p2 = createProvider(
      { provider: "gemini", mode: "api", apiKey: "gk" },
      { fetch: list },
    );
    const models = await p2.listModels();
    expect(models).toEqual([
      { id: "gem-1", label: "gem-1", efforts: [], source: "api" },
      { id: "gem-2", label: "gem-2", efforts: [], source: "api" },
    ]);
  });
});
