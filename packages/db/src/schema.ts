import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const workspaceRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

/** 봉투 암호화 결과(@autofarm/vault SealedSecret) — 평문은 DB에 저장하지 않는다. */
export type SealedSecretJson = { v: 1; kid: string; edk: string; iv: string; tag: string; ct: string };

// ─── 계정·워크스페이스 ──────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: createdAt(),
});

export type TaxType = "general" | "simple";

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  businessNo: text("business_no"),
  /** 과세유형: 일반(general) · 간이(simple) */
  taxType: text("tax_type").$type<TaxType>().notNull().default("general"),
  /** 진입 %·리드타임·수수료 등 워크스페이스 파라미터(프리셋 위에 덮어씀) */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: workspaceRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "member">().notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    /** 세션 토큰의 sha256 — 토큰 원문은 쿠키에만 있다 */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_ws_at_idx").on(t.workspaceId, t.at)],
);

// ─── 연결(S0) ──────────────────────────────────────────────────────

export type ConnectionStatus = "unset" | "ok" | "expired" | "blocked" | "error";
export type ConnectionAuth = "api_key" | "login" | "cookie" | "oauth" | "none";

export const connections = pgTable(
  "connections",
  {
    id: id(),
    workspaceId: workspaceRef(),
    /** 예: supplier:adminplus · data:naver-datalab · data:naver-searchad · data:itemscout · channel:coupang-wing · sheet:google · ai:claude */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    authType: text("auth_type").$type<ConnectionAuth>().notNull(),
    status: text("status").$type<ConnectionStatus>().notNull().default("unset"),
    statusMessage: text("status_message"),
    secret: jsonb("secret").$type<SealedSecretJson>(),
    /** 화면 표시용 끝 4자리 등 */
    secretHint: text("secret_hint"),
    /** 비밀이 아닌 설정(공급처 주소·merchantId·시트 ID 등) */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentPurpose: text("consent_purpose"),
    retainUntil: timestamp("retain_until", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connections_ws_kind_label_uq").on(t.workspaceId, t.kind, t.label)],
);

// ─── AI ───────────────────────────────────────────────────────────

export type AiProviderId = "claude" | "codex" | "muse" | "gemini";
export type AiAuthMode = "subscription" | "api";

export const aiSettings = pgTable("ai_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  provider: text("provider").$type<AiProviderId>().notNull(),
  mode: text("mode").$type<AiAuthMode>().notNull(),
  /** 용도별 모델: { "text.fast": {model, effort}, "text.quality": {...}, "image": {...} } */
  models: jsonb("models")
    .$type<Record<string, { model: string; effort?: string }>>()
    .notNull()
    .default({}),
  /** 월 예산 한도(원) — 운영자 키 비용 상한, null = 없음 */
  monthlyBudgetKrw: integer("monthly_budget_krw"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    workspaceId: workspaceRef(),
    provider: text("provider").$type<AiProviderId>().notNull(),
    mode: text("mode").$type<AiAuthMode>().notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    ok: boolean("ok").notNull(),
    errorKind: text("error_kind"),
    /** null = 제공자가 토큰을 주지 않음(추정하지 않는다) */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    elapsedMs: integer("elapsed_ms").notNull(),
    purpose: text("purpose"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_ws_at_idx").on(t.workspaceId, t.at)],
);

// ─── 작업(워커) ─────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "waiting_human" | "dead";

export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    workspaceId: workspaceRef(),
    type: text("type").notNull(),
    /** 멱등 키(예: sourcing_run_id + 단계) — 같은 키는 한 번만 실행 */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    message: text("message"),
    attempts: integer("attempts").notNull().default(0),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("job_runs_ws_key_uq").on(t.workspaceId, t.idempotencyKey),
    index("job_runs_ws_status_idx").on(t.workspaceId, t.status),
  ],
);

// ─── 공급처(S3) ────────────────────────────────────────────────────

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    platform: text("platform").$type<"adminplus" | "baljuora" | "cafe24" | "custom-session" | "manual">().notNull(),
    siteUrl: text("site_url"),
    orderPageUrl: text("order_page_url"),
    cardPayment: boolean("card_payment"),
    connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "set null" }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_ws_name_uq").on(t.workspaceId, t.name)],
);

export const supplierProducts = pgTable(
  "supplier_products",
  {
    id: id(),
    workspaceId: workspaceRef(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    status: text("status").$type<"active" | "soldout" | "inactive" | "unknown">().notNull(),
    shippingFee: integer("shipping_fee"),
    shippingNote: text("shipping_note"),
    orderCutoff: text("order_cutoff"),
    courier: text("courier"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    raw: jsonb("raw"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supplier_products_uq").on(t.supplierId, t.externalId)],
);

export const supplierOptions = pgTable("supplier_options", {
  id: id(),
  workspaceId: workspaceRef(),
  productId: uuid("product_id")
    .notNull()
    .references(() => supplierProducts.id, { onDelete: "cascade" }),
  optionName: text("option_name").notNull(),
  supplyPrice: integer("supply_price"),
  shippingFee: integer("shipping_fee"),
  extraFeeJeju: integer("extra_fee_jeju"),
  extraFeeIsland: integer("extra_fee_island"),
  weightKg: numeric("weight_kg", { precision: 8, scale: 3 }),
  count: integer("count"),
  sizeGrade: text("size_grade"),
  qualityGrade: text("quality_grade"),
  unitPricePerKg: integer("unit_price_per_kg"),
  stock: integer("stock"),
  status: text("status"),
  parseOk: boolean("parse_ok").notNull().default(false),
});

// ─── 수요·검증(S1·S2) ──────────────────────────────────────────────

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: id(),
    workspaceId: workspaceRef(),
    keyword: text("keyword").notNull(),
    /** itemscout · naver-searchad · naver-datalab · reconstructed · aside · manual */
    source: text("source").notNull(),
    metric: text("metric").notNull(),
    value: jsonb("value").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("metric_ws_kw_idx").on(t.workspaceId, t.keyword, t.metric)],
);

export const trendSeries = pgTable(
  "trend_series",
  {
    id: id(),
    workspaceId: workspaceRef(),
    keyword: text("keyword").notNull(),
    source: text("source").notNull(),
    granularity: text("granularity").$type<"day" | "week" | "month">().notNull(),
    /** 상대값(0~100)인지 절대값인지 */
    scale: text("scale").$type<"relative" | "absolute">().notNull(),
    points: jsonb("points").$type<Array<{ period: string; value: number; predicted?: boolean }>>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trend_ws_kw_idx").on(t.workspaceId, t.keyword)],
);

export const sourcingRuns = pgTable("sourcing_runs", {
  id: id(),
  workspaceId: workspaceRef(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  inputMode: text("input_mode").$type<"none" | "group" | "item">().notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  targetWindowStart: date("target_window_start").notNull(),
  targetWindowEnd: date("target_window_end").notNull(),
  /** 실행 시점 파라미터 전체 스냅샷(재현성) */
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const candidates = pgTable(
  "candidates",
  {
    id: id(),
    workspaceId: workspaceRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => sourcingRuns.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    leaderKeyword: text("leader_keyword"),
    origin: text("origin").notNull(),
    /** 관문별 결과: [{ gate, pass, reason, values }] */
    gates: jsonb("gates").$type<Array<Record<string, unknown>>>().notNull().default([]),
    verdictDaangn: text("verdict_daangn"),
    verdictCoupang: text("verdict_coupang"),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default([]),
    graphType: text("graph_type"),
    recommendedDate: date("recommended_date"),
    snapshotIds: jsonb("snapshot_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [index("candidates_run_idx").on(t.runId)],
);

export const pricePlans = pgTable("price_plans", {
  id: id(),
  workspaceId: workspaceRef(),
  candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
  channel: text("channel").$type<"daangn" | "coupang">().notNull(),
  supplierOptionId: uuid("supplier_option_id").references(() => supplierOptions.id, { onDelete: "set null" }),
  optionLabel: text("option_label").notNull(),
  wholesale: integer("wholesale").notNull(),
  marginRate: real("margin_rate").notNull(),
  feeRate: real("fee_rate").notNull(),
  salePrice: integer("sale_price").notNull(),
  listPrice: integer("list_price"),
  coupon: integer("coupon"),
  extraAmount: integer("extra_amount"),
  sheetSalePrice: integer("sheet_sale_price"),
  sheetMismatch: boolean("sheet_mismatch"),
  createdAt: createdAt(),
});

export const handoffs = pgTable("handoffs", {
  id: id(),
  workspaceId: workspaceRef(),
  runId: uuid("run_id")
    .notNull()
    .references(() => sourcingRuns.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  adoptedBy: uuid("adopted_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const seasonCalendar = pgTable(
  "season_calendar",
  {
    id: id(),
    workspaceId: workspaceRef(),
    keyword: text("keyword").notNull(),
    category: text("category").$type<"fruit" | "produce" | "seafood" | "other">().notNull(),
    month: integer("month").notNull(),
    kind: text("kind").$type<"adopted" | "missed" | "held" | "rejected">().notNull(),
    note: text("note"),
    sourceRunId: uuid("source_run_id").references(() => sourcingRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("season_ws_month_idx").on(t.workspaceId, t.month)],
);

export const assets = pgTable("assets", {
  id: id(),
  workspaceId: workspaceRef(),
  kind: text("kind").$type<"image" | "pdf" | "zip" | "other">().notNull(),
  path: text("path").notNull(),
  bytes: bigint("bytes", { mode: "number" }),
  /** supplier · own-photo · ai-generated · reference */
  origin: text("origin").notNull(),
  sourceUrl: text("source_url"),
  derivedFrom: uuid("derived_from"),
  retainUntil: timestamp("retain_until", { withTimezone: true }),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});
