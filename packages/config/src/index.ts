import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** 설계서 §6-3 — 실제 값은 config/presets.private.json(커밋 금지), 없으면 example. */
export type Presets = {
  timing: {
    entryPercent: number;
    leadDays: number;
    lateEntryRange: [number, number];
    spikeMaxDays: number;
    targetWindowStartWeeks?: number;
    targetWindowDays?: number;
  };
  channels: {
    daangn: { feeRate: number; minPeakSearch: number; tryPeakSearch?: number };
    coupang: { feeRate: number; couponAmount: number; minPeakSearch: number; maxRocket: number; minPeakToProductRatio?: number };
  };
  discovery: {
    minSearch: number;
    shoppingOnly: boolean;
    excludeMajorBrands: boolean;
    sortBy: string;
    categoryDepth?: number;
    period?: string;
    altMinSearch?: number[];
  };
};

export type SupplierSeed = {
  name: string;
  platform: "adminplus" | "baljuora" | "cafe24" | "custom-session" | "manual";
  siteUrl?: string;
  orderPageUrl?: string;
  cardPayment?: boolean;
  config?: Record<string, unknown>;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** 깊은 병합: 뒤의 값이 앞을 덮어쓴다. `_` 로 시작하는 키(주석)는 버린다. 배열은 통째로 바꾼다. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : (over as T);
  const out: Json = {};
  for (const [k, v] of Object.entries(base)) if (!k.startsWith("_")) out[k] = v;
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith("_")) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function readJson(file: string): Json {
  const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!isObj(data)) throw new Error(`${file}: 객체 JSON 이 아닙니다`);
  return data;
}

export function loadPresets(configDir: string): { presets: Presets; source: "private" | "example" } {
  const example = readJson(path.join(configDir, "presets.example.json")) as unknown as Presets;
  const privateFile = path.join(configDir, "presets.private.json");
  if (!existsSync(privateFile)) return { presets: deepMerge(example, {}), source: "example" };
  return { presets: deepMerge(example, readJson(privateFile)), source: "private" };
}

export function loadSupplierSeeds(configDir: string): SupplierSeed[] {
  const file = path.join(configDir, "suppliers.private.json");
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(data)) throw new Error("suppliers.private.json 은 배열이어야 합니다");
  return data.map((s: unknown, i) => {
    if (!isObj(s) || typeof s.name !== "string" || typeof s.platform !== "string") {
      throw new Error(`공급처 ${i}: name·platform 이 필요합니다`);
    }
    return s as unknown as SupplierSeed;
  });
}
