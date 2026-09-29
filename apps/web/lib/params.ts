/** 워크스페이스 파라미터 — 설계서 §6-3. 발굴 프리셋 실제 값은 비공개 파일에서 시드된다. */
export type WorkspaceParams = {
  entryPercent: number;
  leadDays: number;
  feeDaangn: number;
  feeCoupang: number;
  couponCoupang: number;
};
export const DEFAULT_PARAMS: WorkspaceParams = { entryPercent: 25, leadDays: 5, feeDaangn: 0.033, feeCoupang: 0.12, couponCoupang: 10000 };

export function readParams(settings: Record<string, unknown>): WorkspaceParams {
  const p = (settings.params ?? {}) as Partial<WorkspaceParams>;
  return { ...DEFAULT_PARAMS, ...p };
}
