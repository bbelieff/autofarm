import type { ConnectionAuth } from "@autofarm/db";

export type Field = { name: string; label: string; secret: boolean; placeholder?: string };
export type KindSpec = {
  kind: string;
  group: "데이터" | "공급처" | "채널" | "시트" | "AI";
  title: string;
  authType: ConnectionAuth;
  fields: Field[];
  /** 대신 로그인(세션) — 동의·보관 기간 필수 */
  sessionLogin?: boolean;
  healthCheck: boolean;
  adminOnly?: boolean;
  note?: string;
};

export const CATALOG: KindSpec[] = [
  {
    kind: "data:naver-searchad",
    group: "데이터",
    title: "네이버 검색광고 API (월간 검색수)",
    authType: "api_key",
    healthCheck: true,
    fields: [
      { name: "customer_id", label: "고객 ID (CUSTOMER_ID)", secret: true },
      { name: "access_license", label: "액세스라이선스", secret: true },
      { name: "secret_key", label: "비밀키", secret: true },
    ],
  },
  {
    kind: "data:naver-datalab",
    group: "데이터",
    title: "네이버 데이터랩 (NAVER Cloud API HUB)",
    authType: "api_key",
    healthCheck: true,
    fields: [
      { name: "client_id", label: "Client ID", secret: true },
      { name: "client_secret", label: "Client Secret", secret: true },
    ],
  },
  {
    kind: "data:itemscout",
    group: "데이터",
    title: "아이템스카우트 (로그인 세션)",
    authType: "cookie",
    sessionLogin: true,
    healthCheck: false,
    fields: [{ name: "session", label: "로그인 토큰/쿠키", secret: true }],
    note: "점검·수집은 P1(#17)에서 연결됩니다.",
  },
  {
    kind: "supplier:adminplus",
    group: "공급처",
    title: "어드민플러스 계열 공급처 (Open API)",
    authType: "api_key",
    healthCheck: false,
    fields: [
      { name: "supplier_name", label: "공급처 이름", secret: false },
      { name: "base_url", label: "사이트 주소", secret: false, placeholder: "https://" },
      { name: "api_key", label: "API 키", secret: true },
    ],
    note: "점검·수집은 P1(#26)에서 연결됩니다.",
  },
  {
    kind: "supplier:baljuora",
    group: "공급처",
    title: "발주오라 계열 공급처 (대신 로그인)",
    authType: "login",
    sessionLogin: true,
    healthCheck: false,
    fields: [
      { name: "supplier_name", label: "공급처 이름", secret: false },
      { name: "shop_url", label: "쇼핑몰 주소", secret: false, placeholder: "https://" },
      { name: "merchant_id", label: "merchantId", secret: false },
      { name: "username", label: "아이디", secret: true },
      { name: "password", label: "비밀번호", secret: true },
    ],
    note: "P1(#27)",
  },
  {
    kind: "supplier:cafe24",
    group: "공급처",
    title: "자체몰·Cafe24 공급처 (대신 로그인)",
    authType: "login",
    sessionLogin: true,
    healthCheck: false,
    fields: [
      { name: "supplier_name", label: "공급처 이름", secret: false },
      { name: "shop_url", label: "쇼핑몰 주소", secret: false, placeholder: "https://" },
      { name: "username", label: "아이디", secret: true },
      { name: "password", label: "비밀번호", secret: true },
    ],
    note: "P1(#28)",
  },
  {
    kind: "channel:coupang-wing",
    group: "채널",
    title: "쿠팡 WING Open API",
    authType: "api_key",
    healthCheck: false,
    fields: [
      { name: "vendor_id", label: "업체 코드", secret: false },
      { name: "access_key", label: "Access Key", secret: true },
      { name: "secret_key", label: "Secret Key", secret: true },
    ],
    note: "P3",
  },
  {
    kind: "ai:claude",
    group: "AI",
    title: "Claude API 키",
    authType: "api_key",
    adminOnly: true,
    healthCheck: false,
    fields: [{ name: "api_key", label: "API 키", secret: true }],
  },
  {
    kind: "ai:codex",
    group: "AI",
    title: "OpenAI API 키",
    authType: "api_key",
    adminOnly: true,
    healthCheck: false,
    fields: [{ name: "api_key", label: "API 키", secret: true }],
  },
  {
    kind: "ai:muse",
    group: "AI",
    title: "Meta Model API 키 (Muse Spark)",
    authType: "api_key",
    adminOnly: true,
    healthCheck: false,
    fields: [
      { name: "base_url", label: "API 주소", secret: false },
      { name: "api_key", label: "API 키", secret: true },
    ],
    note: "결제 등록 10-13 예정",
  },
  {
    kind: "ai:gemini",
    group: "AI",
    title: "Gemini API 키",
    authType: "api_key",
    adminOnly: true,
    healthCheck: false,
    fields: [{ name: "api_key", label: "API 키", secret: true }],
  },
];

export const specOf = (kind: string) => CATALOG.find((c) => c.kind === kind);
