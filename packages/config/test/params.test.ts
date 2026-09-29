import { describe, expect, it } from "vitest";
import { checkParams, effectiveParams, PARAM_FIELDS, paramsFromPresets, sanitizeOverrides } from "../src";

const presets = {
  timing: { entryPercent: 25, leadDays: 5, lateEntryRange: [30, 40] as [number, number], spikeMaxDays: 3 },
  channels: {
    daangn: { feeRate: 0.033, minPeakSearch: 30000, tryPeakSearch: 10000 },
    coupang: { feeRate: 0.12, couponAmount: 10000, minPeakSearch: 5000, maxRocket: 2, minPeakToProductRatio: 2 },
  },
  discovery: { minSearch: 5000, shoppingOnly: true, excludeMajorBrands: true, sortBy: "productCountAsc" },
  pricing: { marginCoupangPct: 21.33 },
};

describe("소싱 기준", () => {
  it("프리셋을 % 단위 기준으로 바꾼다", () => {
    const p = paramsFromPresets(presets);
    expect(p.daangnMinPeak).toBe(30000);
    expect(p.coupangMinPeak).toBe(5000);
    expect(p.feeDaangnPct).toBe(3.3);
    expect(p.feeCoupangPct).toBe(12);
    expect(p.lateEntryMaxPct).toBe(40);
    expect(p.sortByFewestProducts).toBe(true);
    expect(p.marginCoupangPct).toBe(21.33);
  });

  it("모든 필드에 기본값이 있다", () => {
    const p = paramsFromPresets({});
    for (const f of PARAM_FIELDS) expect(p[f.key], f.key).not.toBeUndefined();
  });

  it("범위 밖·모르는 키·형식 틀린 값은 버린다", () => {
    expect(sanitizeOverrides({ entryPercent: 500, leadDays: "7", unknown: 1, shoppingOnly: "yes", priceEnding: 700 })).toEqual({ leadDays: 7 });
  });

  it("워크스페이스 값이 기본값을 덮어쓴다", () => {
    const p = effectiveParams(paramsFromPresets(presets), { daangnMinPeak: 20000, excludeSoftProduce: false });
    expect(p.daangnMinPeak).toBe(20000);
    expect(p.excludeSoftProduce).toBe(false);
    expect(p.coupangMinPeak).toBe(5000);
  });

  it("어긋난 조합을 알려준다", () => {
    const p = { ...paramsFromPresets(presets), lateEntryMinPct: 50, lateEntryMaxPct: 40, daangnTryPeak: 40000 };
    expect(checkParams(p)).toHaveLength(2);
    expect(checkParams(paramsFromPresets(presets))).toEqual([]);
  });
});
