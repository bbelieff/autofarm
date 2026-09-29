import type { Presets } from "./index";

/**
 * 소싱 기준(워크스페이스에서 조절). 기본값은 프리셋(교안 기준, 비공개 파일)에서 오고,
 * 워크스페이스 설정에 저장된 값이 그 위에 덮어쓴다. 비율은 % 단위로 보관한다.
 */
export type SourcingParams = {
  // 시점
  entryPercent: number;
  leadDays: number;
  targetWindowStartWeeks: number;
  targetWindowDays: number;
  lateEntryMinPct: number;
  lateEntryMaxPct: number;
  spikeMaxDays: number;
  seasonRepeatYears: number;
  excludeForecast: boolean;
  // 수요·경쟁
  daangnMinPeak: number;
  daangnTryPeak: number;
  coupangMinPeak: number;
  minPeakToProductRatio: number;
  maxRocket: number;
  crossCheckTolerancePct: number;
  // 발굴 필터
  discoveryMinSearch: number;
  categoryDepth: number;
  shoppingOnly: boolean;
  excludeMajorBrands: boolean;
  sortByFewestProducts: boolean;
  excludeSoftProduce: boolean;
  // 가격
  feeDaangnPct: number;
  feeCoupangPct: number;
  couponCoupang: number;
  marginDaangnPct: number;
  marginCoupangPct: number;
  decoyRoundDown: boolean;
  priceEnding: 800 | 900;
};

export type ParamKey = keyof SourcingParams;
export type ParamGroup = "시점" | "수요·경쟁" | "발굴 필터" | "가격";

type NumberField = { key: ParamKey; group: ParamGroup; label: string; help: string; type: "number"; unit?: string; min: number; max: number; step: number };
type BoolField = { key: ParamKey; group: ParamGroup; label: string; help: string; type: "boolean" };
type SelectField = { key: ParamKey; group: ParamGroup; label: string; help: string; type: "select"; options: { value: number; label: string }[] };
export type ParamField = NumberField | BoolField | SelectField;

export const PARAM_GROUPS: ParamGroup[] = ["시점", "수요·경쟁", "발굴 필터", "가격"];

export const PARAM_FIELDS: ParamField[] = [
  { key: "entryPercent", group: "시점", type: "number", label: "진입 %", unit: "%", min: 1, max: 90, step: 1, help: "작년 1년 일간 그래프에서 최고점을 100으로 볼 때, 이 값을 처음 넘는 날을 진입일로 본다" },
  { key: "leadDays", group: "시점", type: "number", label: "리드타임", unit: "일", min: 0, max: 60, step: 1, help: "등록 권장일 = 진입일 − 리드타임(리뷰가 쌓이고 1페이지에 자리 잡는 기간)" },
  { key: "targetWindowStartWeeks", group: "시점", type: "number", label: "판매 목표 시작", unit: "주 뒤", min: 0, max: 26, step: 1, help: "무입력 발굴 때 오늘부터 몇 주 뒤를 판매 시작으로 볼지" },
  { key: "targetWindowDays", group: "시점", type: "number", label: "판매 목표 기간", unit: "일", min: 7, max: 120, step: 1, help: "판매 목표 구간의 길이(작년 같은 구간의 검색 키워드를 본다)" },
  { key: "lateEntryMinPct", group: "시점", type: "number", label: "후반 진입 구간 시작", unit: "%", min: 0, max: 100, step: 1, help: "완만하게 오래 가는 그래프만: 내려오는 구간에서 이 %부터 진입 허용" },
  { key: "lateEntryMaxPct", group: "시점", type: "number", label: "후반 진입 구간 끝", unit: "%", min: 0, max: 100, step: 1, help: "후반 진입을 허용하는 마지막 %" },
  { key: "spikeMaxDays", group: "시점", type: "number", label: "이슈 스파이크 폭", unit: "일", min: 0, max: 14, step: 1, help: "이 일수 이하로 반짝 솟았다 꺼지는 봉우리는 뉴스·방송성으로 보고 무시" },
  { key: "seasonRepeatYears", group: "시점", type: "number", label: "시즌 반복 확인", unit: "년", min: 1, max: 3, step: 1, help: "같은 달 봉우리가 최근 몇 년 반복돼야 시즌으로 인정할지" },
  { key: "excludeForecast", group: "시점", type: "boolean", label: "예측 구간 제외", help: "그래프 오른쪽 끝의 예측값은 판단에 쓰지 않는다" },

  { key: "daangnMinPeak", group: "수요·경쟁", type: "number", label: "당근 합격선(피크 월검색량)", unit: "회", min: 0, max: 1000000, step: 1000, help: "작년 피크 달 검색량이 이 이상이면 당근 추천" },
  { key: "daangnTryPeak", group: "수요·경쟁", type: "number", label: "당근 시도선", unit: "회", min: 0, max: 1000000, step: 1000, help: "합격선보다 낮지만 이 이상이면 「시도」로 표시" },
  { key: "coupangMinPeak", group: "수요·경쟁", type: "number", label: "쿠팡 하한(피크 월검색량)", unit: "회", min: 0, max: 1000000, step: 500, help: "작은 시장도 팔리는 쿠팡의 최소 검색량" },
  { key: "minPeakToProductRatio", group: "수요·경쟁", type: "number", label: "시장 크기 비율(피크 검색수 ÷ 쿠팡 상품수)", unit: "배", min: 0, max: 100, step: 0.1, help: "찾는 사람이 파는 사람보다 몇 배 많아야 하는지" },
  { key: "maxRocket", group: "수요·경쟁", type: "number", label: "쿠팡 1페이지 로켓 허용", unit: "개", min: 0, max: 40, step: 1, help: "1페이지 로켓배송 상품이 이보다 많으면 감점" },
  { key: "crossCheckTolerancePct", group: "수요·경쟁", type: "number", label: "출처 간 차이 경고", unit: "%", min: 0, max: 100, step: 1, help: "아이템스카우트와 공식 API 재구성 값 차이가 이보다 크면 경고" },

  { key: "discoveryMinSearch", group: "발굴 필터", type: "number", label: "발굴 검색수 하한", unit: "회", min: 0, max: 1000000, step: 1000, help: "아이템 발굴에서 이 검색수 미만은 거른다(후보가 적으면 낮춘다)" },
  { key: "categoryDepth", group: "발굴 필터", type: "number", label: "카테고리 깊이", unit: "단계", min: 1, max: 4, step: 1, help: "더 좁히면 키워드가 사라질 수 있다" },
  { key: "shoppingOnly", group: "발굴 필터", type: "boolean", label: "쇼핑성 키워드만", help: "정보성(블로그를 보러 온) 키워드는 거른다" },
  { key: "excludeMajorBrands", group: "발굴 필터", type: "boolean", label: "주요 브랜드 제외", help: "브랜드 상품은 위탁 시 지재권 문제" },
  { key: "sortByFewestProducts", group: "발굴 필터", type: "boolean", label: "상품수 적은 순으로 훑기", help: "파는 사람이 적은 키워드부터 본다" },
  { key: "excludeSoftProduce", group: "발굴 필터", type: "boolean", label: "무른 품목 제외", help: "배송 중 물러 CS가 많은 품목(홍시 등)은 후보에서 뺀다" },

  { key: "feeDaangnPct", group: "가격", type: "number", label: "당근 수수료", unit: "%", min: 0, max: 50, step: 0.1, help: "판매가 = 공급가 ÷ (1 − 마진율 − 수수료)" },
  { key: "feeCoupangPct", group: "가격", type: "number", label: "쿠팡 수수료(보수적)", unit: "%", min: 0, max: 50, step: 0.1, help: "카테고리 최대 수수료 + 부가세를 올림" },
  { key: "couponCoupang", group: "가격", type: "number", label: "쿠팡 쿠폰액", unit: "원", min: 0, max: 100000, step: 500, help: "등록가 = 실판매가 + 쿠폰액. 도매가가 오르면 옵션가 대신 쿠폰을 줄인다" },
  { key: "marginDaangnPct", group: "가격", type: "number", label: "당근 기본 마진율", unit: "%", min: 0, max: 80, step: 0.1, help: "품목별로 따로 정하기 전의 시작값(첫 사이클은 낮게 잡는 것도 방법)" },
  { key: "marginCoupangPct", group: "가격", type: "number", label: "쿠팡 기본 마진율", unit: "%", min: 0, max: 80, step: 0.1, help: "품목별로 따로 정하기 전의 시작값" },
  { key: "decoyRoundDown", group: "가격", type: "boolean", label: "최저 옵션은 끝자리 내림(미끼)", help: "목록 최저가를 낮춰 클릭을 산다. 나머지 옵션은 올림" },
  { key: "priceEnding", group: "가격", type: "select", label: "가격 끝자리", options: [{ value: 900, label: "…900" }, { value: 800, label: "…800" }], help: "끝자리를 맞춘 가격이 더 매력적으로 보인다" },
];

/** 프리셋에 없을 때 쓰는 중립 기본값(공개 레포에 있어도 되는 값) */
const NEUTRAL: SourcingParams = {
  entryPercent: 25,
  leadDays: 5,
  targetWindowStartWeeks: 3,
  targetWindowDays: 30,
  lateEntryMinPct: 30,
  lateEntryMaxPct: 40,
  spikeMaxDays: 3,
  seasonRepeatYears: 2,
  excludeForecast: true,
  daangnMinPeak: 0,
  daangnTryPeak: 0,
  coupangMinPeak: 0,
  minPeakToProductRatio: 0,
  maxRocket: 40,
  crossCheckTolerancePct: 30,
  discoveryMinSearch: 0,
  categoryDepth: 3,
  shoppingOnly: true,
  excludeMajorBrands: true,
  sortByFewestProducts: true,
  excludeSoftProduce: true,
  feeDaangnPct: 3.3,
  feeCoupangPct: 12,
  couponCoupang: 10000,
  marginDaangnPct: 30,
  marginCoupangPct: 21.33,
  decoyRoundDown: true,
  priceEnding: 900,
};

const pct = (rate: number | undefined) => (rate === undefined ? undefined : Math.round(rate * 10000) / 100);
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** 프리셋(교안 기준) → 소싱 기준 기본값 */
export function paramsFromPresets(p: Partial<Presets> & { pricing?: Record<string, unknown>; validation?: Record<string, unknown> }): SourcingParams {
  const t = p.timing;
  const d = p.channels?.daangn;
  const c = p.channels?.coupang;
  const f = p.discovery;
  const pr = (p.pricing ?? {}) as Partial<Pick<SourcingParams, "marginDaangnPct" | "marginCoupangPct" | "decoyRoundDown" | "priceEnding">>;
  const v = (p.validation ?? {}) as Partial<Pick<SourcingParams, "seasonRepeatYears" | "crossCheckTolerancePct" | "excludeSoftProduce" | "excludeForecast">>;
  return {
    ...NEUTRAL,
    ...defined({
      entryPercent: t?.entryPercent,
      leadDays: t?.leadDays,
      targetWindowStartWeeks: t?.targetWindowStartWeeks,
      targetWindowDays: t?.targetWindowDays,
      lateEntryMinPct: t?.lateEntryRange?.[0],
      lateEntryMaxPct: t?.lateEntryRange?.[1],
      spikeMaxDays: t?.spikeMaxDays,
      daangnMinPeak: d?.minPeakSearch,
      daangnTryPeak: d?.tryPeakSearch,
      feeDaangnPct: pct(d?.feeRate),
      coupangMinPeak: c?.minPeakSearch,
      minPeakToProductRatio: c?.minPeakToProductRatio,
      maxRocket: c?.maxRocket,
      feeCoupangPct: pct(c?.feeRate),
      couponCoupang: c?.couponAmount,
      discoveryMinSearch: f?.minSearch,
      categoryDepth: f?.categoryDepth,
      shoppingOnly: f?.shoppingOnly,
      excludeMajorBrands: f?.excludeMajorBrands,
      sortByFewestProducts: f?.sortBy === undefined ? undefined : f.sortBy === "productCountAsc",
    }),
    ...defined(pr),
    ...defined(v),
  };
}

/** 저장된 워크스페이스 값 중 알려진 키·올바른 형식·범위 안의 값만 남긴다. */
export function sanitizeOverrides(input: Record<string, unknown>): Partial<SourcingParams> {
  const out: Record<string, unknown> = {};
  for (const f of PARAM_FIELDS) {
    const raw = input[f.key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (f.type === "boolean") {
      if (typeof raw === "boolean") out[f.key] = raw;
    } else if (f.type === "select") {
      const n = Number(raw);
      if (f.options.some((o) => o.value === n)) out[f.key] = n;
    } else {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= f.min && n <= f.max) out[f.key] = n;
    }
  }
  return out as Partial<SourcingParams>;
}

export function effectiveParams(defaults: SourcingParams, overrides: Record<string, unknown> | undefined): SourcingParams {
  return { ...defaults, ...sanitizeOverrides(overrides ?? {}) };
}

/** 서로 맞지 않는 값 조합 검사(저장 전) */
export function checkParams(p: SourcingParams): string[] {
  const errs: string[] = [];
  if (p.lateEntryMinPct > p.lateEntryMaxPct) errs.push("후반 진입 구간: 시작이 끝보다 큽니다");
  if (p.daangnTryPeak > p.daangnMinPeak && p.daangnMinPeak > 0) errs.push("당근 시도선이 합격선보다 큽니다");
  if (p.marginDaangnPct + p.feeDaangnPct >= 100) errs.push("당근 마진율 + 수수료가 100% 이상입니다");
  if (p.marginCoupangPct + p.feeCoupangPct >= 100) errs.push("쿠팡 마진율 + 수수료가 100% 이상입니다");
  return errs;
}
