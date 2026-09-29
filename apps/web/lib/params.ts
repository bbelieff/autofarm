import "server-only";
import path from "node:path";
import { effectiveParams, loadPresets, paramsFromPresets, type SourcingParams } from "@autofarm/config";

/** 프리셋 위치: CONFIG_DIR 또는 레포 루트 config/ (웹은 apps/web 에서 실행됨) */
function configDir() {
  return process.env.CONFIG_DIR ?? path.resolve(process.cwd(), "../../config");
}

let cached: { defaults: SourcingParams; source: "private" | "example" } | null = null;

/** 교안 기준(비공개 프리셋) 기본값. 파일이 없으면 공개 예시 값. */
export function defaultParams() {
  if (!cached) {
    const { presets, source } = loadPresets(configDir());
    cached = { defaults: paramsFromPresets(presets), source };
  }
  return cached;
}

export function readParams(settings: Record<string, unknown>): SourcingParams {
  return effectiveParams(defaultParams().defaults, (settings.params ?? {}) as Record<string, unknown>);
}
