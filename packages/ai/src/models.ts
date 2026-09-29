import type { Effort, ModelInfo, ProviderId } from "./types";

/** Claude subscription/API efforts (docs/ai-providers.md §2). */
export const CLAUDE_EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Codex efforts for API-listed (unknown) models: union of all known levels. */
export const CODEX_API_EFFORTS: Effort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/** Muse Spark efforts (CLI help: none..ultra, default high). */
export const MUSE_EFFORTS: Effort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const ALL_EFFORTS: Effort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const KNOWN_EFFORTS: ReadonlySet<string> = new Set<string>(ALL_EFFORTS);

export function isEffort(v: unknown): v is Effort {
  return typeof v === "string" && KNOWN_EFFORTS.has(v);
}

/**
 * Snapshot of docs/ai-providers.md §2. The app refreshes this at runtime
 * (API models endpoints / CLI caches); this table is the offline fallback.
 */
export const STATIC_MODELS: Record<ProviderId, ModelInfo[]> = {
  claude: [
    {
      id: "claude-fable-5-1",
      label: "Claude Fable 5.1",
      efforts: [...CLAUDE_EFFORTS],
      source: "static",
    },
    {
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      efforts: [...CLAUDE_EFFORTS],
      source: "static",
    },
    {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      efforts: [...CLAUDE_EFFORTS],
      source: "static",
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      efforts: [...CLAUDE_EFFORTS],
      source: "static",
    },
  ],
  codex: [
    {
      id: "gpt-6-astra",
      label: "gpt-6-astra",
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
      source: "static",
    },
    {
      id: "gpt-6-sol",
      label: "gpt-6-sol",
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
      source: "static",
    },
    {
      id: "gpt-6-luna",
      label: "gpt-6-luna",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      source: "static",
    },
    {
      id: "gpt-5.6-sol",
      label: "gpt-5.6-sol",
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "low",
      source: "static",
    },
    {
      id: "gpt-5.6-terra",
      label: "gpt-5.6-terra",
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
      source: "static",
    },
    {
      id: "gpt-5.6-luna",
      label: "gpt-5.6-luna",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      source: "static",
    },
    {
      id: "gpt-5.5",
      label: "gpt-5.5",
      efforts: ["low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
      source: "static",
    },
  ],
  muse: [
    {
      id: "muse-spark-1.3",
      label: "muse-spark-1.3",
      efforts: [...MUSE_EFFORTS],
      defaultEffort: "high",
      source: "static",
    },
    {
      id: "muse-spark-1.3-contributor",
      label: "muse-spark-1.3-contributor",
      efforts: [...MUSE_EFFORTS],
      defaultEffort: "high",
      source: "static",
    },
    {
      id: "muse-spark-1.2",
      label: "muse-spark-1.2",
      efforts: [...MUSE_EFFORTS],
      defaultEffort: "high",
      source: "static",
    },
    {
      id: "muse-spark-1.2-contributor",
      label: "muse-spark-1.2-contributor",
      efforts: [...MUSE_EFFORTS],
      defaultEffort: "high",
      source: "static",
    },
    {
      id: "muse-spark-1.1",
      label: "muse-spark-1.1",
      efforts: [...MUSE_EFFORTS],
      defaultEffort: "high",
      source: "static",
    },
  ],
  // Gemini is API-only; models come from the API models endpoint.
  gemini: [],
};
