import { createHash } from "node:crypto";

export type ConnectionStatus = "unset" | "ok" | "expired" | "blocked" | "error";

export interface HealthResult {
  status: ConnectionStatus;
  message?: string;
  checkedAt: Date;
}

export interface ConnectorLogger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface ConnectorContext {
  workspaceId: string;
  secrets: Readonly<Record<string, string>>;
  fetch: typeof fetch;
  logger: ConnectorLogger;
  limiter: RateLimiter;
  now(): Date;
  signal?: AbortSignal;
}

export interface SupplierOptionRaw {
  optionName: string;
  price: number;
  stock?: number | null;
  status?: string | null;
  extra?: Record<string, unknown>;
}

export interface SupplierProductRaw {
  externalId: string;
  name: string;
  url?: string | null;
  supplyPrice: number | null;
  shippingFee?: number | null;
  shippingNote?: string | null;
  status: "active" | "soldout" | "inactive" | "unknown";
  stock?: number | null;
  orderCutoff?: string | null;
  courier?: string | null;
  imageUrls: string[];
  options: SupplierOptionRaw[];
  updatedAt?: string | null;
  raw: unknown;
}

export type SupplierKind =
  | "adminplus"
  | "baljuora"
  | "cafe24"
  | "custom-session"
  | "manual";

export interface SupplierConnector {
  kind: SupplierKind;
  healthCheck(ctx: ConnectorContext): Promise<HealthResult>;
  searchProducts(
    ctx: ConnectorContext,
    keyword: string,
  ): Promise<SupplierProductRaw[]>;
  getOrderLink?(ctx: ConnectorContext, externalId: string): string;
}

export type ConnectorErrorCode =
  | "auth_expired"
  | "blocked"
  | "rate_limited"
  | "bad_response"
  | "network";

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: ConnectorErrorCode, cause?: unknown) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.cause = cause;
  }
}

export function statusFromError(e: unknown): ConnectionStatus {
  if (e instanceof ConnectorError) {
    if (e.code === "auth_expired") return "expired";
    if (e.code === "blocked") return "blocked";
  }
  return "error";
}

// ---------------------------------------------------------------------------
// Rate limiter: per-key sliding windows, deterministic via injected clock.
// ---------------------------------------------------------------------------

export interface RateLimiter {
  acquire(key: string): Promise<void>;
}

export function createRateLimiter(opts: {
  perMinute?: number;
  perDay?: number;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): RateLimiter {
  const perMinute = opts.perMinute;
  const perDay = opts.perDay;
  const minIntervalMs = opts.minIntervalMs;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  interface Bucket {
    minute: number[];
    day: number[];
    last: number | undefined;
  }
  const buckets = new Map<string, Bucket>();
  const MINUTE_MS = 60_000;
  const DAY_MS = 86_400_000;

  return {
    async acquire(key: string): Promise<void> {
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = { minute: [], day: [], last: undefined };
        buckets.set(key, bucket);
      }
      for (;;) {
        const t = now();
        bucket.minute = bucket.minute.filter((s) => s > t - MINUTE_MS);
        bucket.day = bucket.day.filter((s) => s > t - DAY_MS);
        if (perDay !== undefined && bucket.day.length >= perDay) {
          throw new ConnectorError(
            `daily rate limit exhausted for ${key}`,
            "rate_limited",
          );
        }
        let waitUntil = -Infinity;
        if (perMinute !== undefined && bucket.minute.length >= perMinute) {
          const oldest = bucket.minute[0];
          if (oldest !== undefined) waitUntil = Math.max(waitUntil, oldest + MINUTE_MS);
        }
        if (
          minIntervalMs !== undefined &&
          bucket.last !== undefined &&
          t - bucket.last < minIntervalMs
        ) {
          waitUntil = Math.max(waitUntil, bucket.last + minIntervalMs);
        }
        if (waitUntil <= t) {
          bucket.minute.push(t);
          bucket.day.push(t);
          bucket.last = t;
          return;
        }
        await sleep(waitUntil - t);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function createRegistry<T extends { kind: string }>(): {
  register(factory: () => T): void;
  get(kind: string): T;
  kinds(): string[];
} {
  const instances = new Map<string, T>();
  return {
    register(factory: () => T): void {
      const instance = factory();
      if (instances.has(instance.kind)) {
        throw new Error(`duplicate connector kind: ${instance.kind}`);
      }
      instances.set(instance.kind, instance);
    },
    get(kind: string): T {
      const instance = instances.get(kind);
      if (instance === undefined) {
        throw new Error(`unknown connector kind: ${kind}`);
      }
      return instance;
    },
    kinds(): string[] {
      return [...instances.keys()];
    },
  };
}

// ---------------------------------------------------------------------------
// Fake connector (local dev / contract-test target)
// ---------------------------------------------------------------------------

function copyProduct(p: SupplierProductRaw): SupplierProductRaw {
  return {
    ...p,
    imageUrls: [...p.imageUrls],
    options: p.options.map((o) => ({ ...o })),
  };
}

export function createFakeSupplierConnector(
  products: SupplierProductRaw[],
): SupplierConnector {
  return {
    kind: "manual",
    async healthCheck(ctx: ConnectorContext): Promise<HealthResult> {
      return { status: "ok", checkedAt: ctx.now() };
    },
    async searchProducts(
      ctx: ConnectorContext,
      keyword: string,
    ): Promise<SupplierProductRaw[]> {
      const kw = keyword.trim().toLowerCase();
      const hits =
        kw === ""
          ? products
          : products.filter((p) => p.name.toLowerCase().includes(kw));
      ctx.logger.info(`fake search ${JSON.stringify(keyword)} -> ${hits.length}`);
      return hits.map(copyProduct);
    },
    getOrderLink(_ctx: ConnectorContext, externalId: string): string {
      return `https://example.invalid/order/${encodeURIComponent(externalId)}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture scrubbing (recorded responses must never carry real PII/product data)
// ---------------------------------------------------------------------------

const DEFAULT_SALT = "autofarm";

function hash8(salt: string, value: string): string {
  return createHash("sha256").update(salt + value, "utf8").digest("hex").slice(0, 8);
}

/** Weight/count tokens preserved on scrubbed product names (e.g. 3kg, 11과). */
const TOKEN_PATTERN = String.raw`\d+(?:\.\d+)?\s?(?:kg|g)\b|\d+\s?(?:과|입)`;

function extractTokens(value: string): string[] {
  return value.match(new RegExp(TOKEN_PATTERN, "gi")) ?? [];
}

function stripTokens(value: string): string {
  return value.replace(new RegExp(TOKEN_PATTERN, "gi"), " ");
}

const NAME_KEYS = new Set(["name", "title", "productName", "optionName", "상품명"]);

const ID_KEYS = new Set([
  "id",
  "externalid",
  "merchantid",
  "productid",
  "code",
]);

function isPriceKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("price") ||
    k.includes("fee") ||
    k.includes("amount") ||
    key.includes("공급가") ||
    key.includes("가격")
  );
}

const URL_PATTERN = /https?:\/\/[^\s"'<>\])]+/g;
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(?=$|[?#])/i;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FIXTURE_PHONE_PATTERN = /01[016789]-?\d{3,4}-?\d{4}/g;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function scrubUrl(url: string, salt: string): string {
  // Keep trailing sentence punctuation outside the scrubbed URL.
  const tail = url.match(/[.,;:!?]+$/)?.[0] ?? "";
  const core = tail === "" ? url : url.slice(0, -tail.length);
  const ext = core.match(IMAGE_EXT_PATTERN)?.[0].toLowerCase() ?? "";
  return `https://example.invalid/${hash8(salt, core)}${ext}${tail}`;
}

function scrubFreeString(s: string, salt: string): string {
  if (ISO_DATE_PATTERN.test(s) && !Number.isNaN(Date.parse(s))) {
    return "<date>";
  }
  return s
    .replace(URL_PATTERN, (m) => scrubUrl(m, salt))
    .replace(UUID_PATTERN, (m) => `id_${hash8(salt, m)}`)
    .replace(EMAIL_PATTERN, "[EMAIL]")
    .replace(FIXTURE_PHONE_PATTERN, "[PHONE]");
}

function scrubStringValue(s: string, key: string | undefined, salt: string): string {
  if (key !== undefined) {
    if (NAME_KEYS.has(key)) {
      const tokens = extractTokens(s);
      const suffix = tokens.length > 0 ? ` ${tokens.join(" ")}` : "";
      return `item_${hash8(salt, s)}${suffix}`;
    }
    if (ID_KEYS.has(key.toLowerCase())) {
      return `id_${hash8(salt, s)}`;
    }
  }
  return scrubFreeString(s, salt);
}

export function scrubFixture(value: unknown, opts?: { salt?: string }): unknown {
  const salt = opts?.salt ?? DEFAULT_SALT;
  const seen = new Map<object, unknown>();

  const visit = (node: unknown, key?: string): unknown => {
    if (typeof node === "string") return scrubStringValue(node, key, salt);
    if (typeof node === "number") {
      if (key !== undefined && isPriceKey(key)) {
        return Math.round(node / 100) * 100;
      }
      return node;
    }
    if (
      node === null ||
      node === undefined ||
      typeof node === "boolean" ||
      typeof node === "bigint"
    ) {
      return node;
    }
    if (typeof node !== "object") return node;
    const cached = seen.get(node);
    if (cached !== undefined) return cached;
    if (Array.isArray(node)) {
      const copy: unknown[] = [];
      seen.set(node, copy);
      for (const item of node) copy.push(visit(item));
      return copy;
    }
    const copy: Record<string, unknown> = {};
    seen.set(node, copy);
    for (const [k, v] of Object.entries(node)) copy[k] = visit(v, k);
    return copy;
  };

  return visit(value);
}

const URL_HOST_PATTERN = /https?:\/\/([^\s"'<>\]/)]+)/g;
const UUID_TEST = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_TEST = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_TEST = /01[016789]-?\d{3,4}-?\d{4}/;
const HANGUL_TEST = /[가-힣]/;

function pathChild(base: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

/** JSON paths that still carry unscrubbed PII / real-product data. */
export function findUnscrubbed(value: unknown): string[] {
  const paths: string[] = [];

  const walk = (node: unknown, path: string, key?: string): void => {
    if (typeof node === "string") {
      let dirty = false;
      for (const m of node.matchAll(URL_HOST_PATTERN)) {
        if (m[1]!.toLowerCase() !== "example.invalid") {
          dirty = true;
          break;
        }
      }
      if (!dirty && UUID_TEST.test(node)) dirty = true;
      if (!dirty && PHONE_TEST.test(node)) dirty = true;
      if (!dirty && EMAIL_TEST.test(node)) dirty = true;
      if (
        !dirty &&
        key !== undefined &&
        NAME_KEYS.has(key) &&
        node.length > 1 &&
        HANGUL_TEST.test(stripTokens(node))
      ) {
        dirty = true;
      }
      if (dirty) paths.push(path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, pathChild(path, k), k);
    }
  };

  walk(value, "$");
  return paths;
}
