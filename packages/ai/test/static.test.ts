import { describe, expect, it } from "vitest";
import {
  AiError,
  STATIC_MODELS,
  createProvider,
  isSupported,
} from "../src/index";
import type { AuthMode, ProviderId } from "../src/index";

describe("isSupported", () => {
  it("allows every provider/mode except gemini+subscription", () => {
    const providers: ProviderId[] = ["claude", "codex", "muse", "gemini"];
    const modes: AuthMode[] = ["subscription", "api"];
    for (const p of providers) {
      for (const m of modes) {
        expect(isSupported(p, m)).toBe(!(p === "gemini" && m === "subscription"));
      }
    }
  });
});

describe("createProvider validation", () => {
  it("throws unsupported for gemini+subscription", () => {
    try {
      createProvider({ provider: "gemini", mode: "subscription" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).kind).toBe("unsupported");
    }
  });

  it("throws config for api mode without apiKey (all providers)", () => {
    const providers: ProviderId[] = ["claude", "codex", "muse", "gemini"];
    for (const provider of providers) {
      try {
        createProvider({ provider, mode: "api" });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).kind).toBe("config");
      }
    }
  });

  it("throws config for muse api without baseUrl, works with one", () => {
    try {
      createProvider({ provider: "muse", mode: "api", apiKey: "k" });
      expect.unreachable();
    } catch (err) {
      expect((err as AiError).kind).toBe("config");
    }
    const p = createProvider({
      provider: "muse",
      mode: "api",
      apiKey: "k",
      baseUrl: "https://meta.example",
    });
    expect(p.id).toBe("muse");
    expect(p.mode).toBe("api");
  });

  it("creates subscription providers with expected id/mode", () => {
    for (const id of ["claude", "codex", "muse"] as const) {
      const p = createProvider({ provider: id, mode: "subscription" });
      expect(p.id).toBe(id);
      expect(p.mode).toBe("subscription");
    }
  });
});

describe("STATIC_MODELS", () => {
  it("has the four claude models with full ids and low..max efforts", () => {
    const ids = STATIC_MODELS.claude.map((m) => m.id);
    for (const id of [
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-4-5-20251001",
    ]) {
      expect(ids).toContain(id);
    }
    for (const m of STATIC_MODELS.claude) {
      expect(m.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(m.source).toBe("static");
    }
  });

  it("has the seven codex models with per-model efforts and defaults", () => {
    const byId = new Map(STATIC_MODELS.codex.map((m) => [m.id, m]));
    expect([...byId.keys()].sort()).toEqual(
      [
        "gpt-5.5",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-6-astra",
        "gpt-6-luna",
        "gpt-6-sol",
      ].sort(),
    );
    expect(byId.get("gpt-6-astra")?.defaultEffort).toBe("medium");
    expect(byId.get("gpt-5.6-sol")?.defaultEffort).toBe("low");
    expect(byId.get("gpt-5.5")?.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(byId.get("gpt-6-sol")?.efforts).toContain("ultra");
    expect(byId.get("gpt-6-luna")?.efforts).not.toContain("ultra");
  });

  it("has the five muse models with none..ultra efforts", () => {
    expect(STATIC_MODELS.muse.map((m) => m.id).sort()).toEqual(
      [
        "muse-spark-1.1",
        "muse-spark-1.2",
        "muse-spark-1.2-contributor",
        "muse-spark-1.3",
        "muse-spark-1.3-contributor",
      ].sort(),
    );
    for (const m of STATIC_MODELS.muse) {
      expect(m.efforts).toEqual([
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ]);
      expect(m.defaultEffort).toBe("high");
    }
  });

  it("has no static gemini models", () => {
    expect(STATIC_MODELS.gemini).toEqual([]);
  });

  it("claude/muse subscription listModels return STATIC_MODELS", async () => {
    const claude = createProvider({ provider: "claude", mode: "subscription" });
    expect(await claude.listModels()).toBe(STATIC_MODELS.claude);
    const muse = createProvider({ provider: "muse", mode: "subscription" });
    expect(await muse.listModels()).toBe(STATIC_MODELS.muse);
  });
});
