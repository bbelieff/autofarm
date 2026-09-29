import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STATIC_MODELS,
  createProvider,
  createUsageMeter,
} from "../src/index";
import type { UsageRecord } from "../src/index";

const CACHE_JSON = JSON.stringify({
  models: [
    {
      slug: "gpt-6-astra",
      display_name: "GPT 6 Astra",
      supported_reasoning_levels: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "bogus" },
      ],
      default_reasoning_level: "medium",
      visibility: "show",
    },
    {
      slug: "gpt-reserve",
      display_name: "Reserve",
      supported_reasoning_levels: [{ effort: "high" }],
      default_reasoning_level: "high",
      visibility: "hide",
    },
  ],
});

describe("codex subscription listModels (cache)", () => {
  it("reads the cache file, maps hidden flag and efforts", async () => {
    const seen: string[] = [];
    const p = createProvider(
      { provider: "codex", mode: "subscription" },
      {
        readFile: async (path: string) => {
          seen.push(path);
          return CACHE_JSON;
        },
      },
    );
    const models = await p.listModels();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.endsWith(path.join(".codex", "models_cache.json"))).toBe(true);
    expect(models).toEqual([
      {
        id: "gpt-6-astra",
        label: "GPT 6 Astra",
        efforts: ["low", "medium"],
        hidden: false,
        source: "cli-cache",
        defaultEffort: "medium",
      },
      {
        id: "gpt-reserve",
        label: "Reserve",
        efforts: ["high"],
        hidden: true,
        source: "cli-cache",
        defaultEffort: "high",
      },
    ]);
  });

  it("honors CODEX_HOME override", async () => {
    let got = "";
    const p = createProvider(
      {
        provider: "codex",
        mode: "subscription",
        env: { CODEX_HOME: "/tmp/fake-codex-home" },
      },
      {
        readFile: async (path: string) => {
          got = path;
          return CACHE_JSON;
        },
      },
    );
    await p.listModels();
    expect(got).toBe(path.join("/tmp/fake-codex-home", "models_cache.json"));
  });

  it("falls back to STATIC_MODELS on missing file or bad JSON", async () => {
    const missing = createProvider(
      { provider: "codex", mode: "subscription" },
      {
        readFile: async () => {
          throw new Error("ENOENT");
        },
      },
    );
    expect(await missing.listModels()).toBe(STATIC_MODELS.codex);

    const bad = createProvider(
      { provider: "codex", mode: "subscription" },
      { readFile: async () => "{{{oops" },
    );
    expect(await bad.listModels()).toBe(STATIC_MODELS.codex);
  });
});

describe("onUsage", () => {
  it("called once on success without prompt/response text", async () => {
    const records: UsageRecord[] = [];
    const secretPrompt = "SECRET-PROMPT-abc123";
    const p = createProvider(
      { provider: "claude", mode: "subscription" },
      {
        runCli: async () => ({
          code: 0,
          stdout: JSON.stringify({
            result: "RESPONSE-xyz789",
            usage: { input_tokens: 1, output_tokens: 2 },
          }),
          stderr: "",
        }),
        onUsage: (r) => records.push(r),
        now: () => 1000,
      },
    );
    const r = await p.generate({
      model: "claude-haiku-4-5-20251001",
      prompt: secretPrompt,
      purpose: "text.fast",
    });
    expect(r.elapsedMs).toBe(0);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec?.ok).toBe(true);
    expect(rec?.purpose).toBe("text.fast");
    expect(rec?.at).toBeInstanceOf(Date);
    const blob = JSON.stringify(rec);
    expect(blob).not.toContain(secretPrompt);
    expect(blob).not.toContain("RESPONSE-xyz789");
    expect(rec).not.toHaveProperty("text");
  });

  it("called once on failure with errorKind, never prompt text", async () => {
    const records: UsageRecord[] = [];
    const secretPrompt = "SECRET-PROMPT-fail999";
    const p = createProvider(
      { provider: "codex", mode: "subscription" },
      {
        runCli: async () => ({ code: 2, stdout: "", stderr: "cli broke" }),
        onUsage: (r) => records.push(r),
      },
    );
    await expect(
      p.generate({ model: "gpt-6-sol", prompt: secretPrompt }),
    ).rejects.toMatchObject({ kind: "cli_failed" });
    expect(records).toHaveLength(1);
    expect(records[0]?.ok).toBe(false);
    expect(records[0]?.errorKind).toBe("cli_failed");
    expect(records[0]?.usage).toBeNull();
    expect(JSON.stringify(records[0])).not.toContain(secretPrompt);
  });
});

describe("createUsageMeter", () => {
  const rec = (over: Partial<UsageRecord> & { model: string }): UsageRecord => ({
    provider: "claude",
    mode: "subscription",
    effort: null,
    usage: { inputTokens: 10, outputTokens: 5 },
    elapsedMs: 100,
    ok: true,
    at: new Date(0),
    ...over,
  });

  it("sums tokens per provider/mode/model group", () => {
    const m = createUsageMeter();
    m.record(rec({ model: "a" }));
    m.record(rec({ model: "a", usage: { inputTokens: 4, outputTokens: 1 }, elapsedMs: 50 }));
    m.record(rec({ model: "b", ok: false, elapsedMs: 20 }));
    const s = m.summary();
    const a = s.find((g) => g.model === "a");
    const b = s.find((g) => g.model === "b");
    expect(a).toMatchObject({
      provider: "claude",
      mode: "subscription",
      calls: 2,
      ok: 2,
      inputTokens: 14,
      outputTokens: 6,
      elapsedMs: 150,
    });
    expect(b).toMatchObject({ calls: 1, ok: 0 });
  });

  it("null-propagates: one null usage poisons the group sum, never estimates", () => {
    const m = createUsageMeter();
    m.record(rec({ model: "a" }));
    m.record(rec({ model: "a", usage: null }));
    m.record(
      rec({ model: "c", usage: { inputTokens: null, outputTokens: 3 } }),
    );
    const s = m.summary();
    expect(s.find((g) => g.model === "a")).toMatchObject({
      inputTokens: null,
      outputTokens: null,
    });
    expect(s.find((g) => g.model === "c")).toMatchObject({
      inputTokens: null,
      outputTokens: 3,
    });
  });
});
