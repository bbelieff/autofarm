import { describe, expect, it } from "vitest";
import {
  ConnectorError,
  createFakeSupplierConnector,
  createRateLimiter,
  createRegistry,
  findUnscrubbed,
  scrubFixture,
  statusFromError,
} from "../src/index";
import type { ConnectorContext } from "../src/index";

function makeCtx(): ConnectorContext {
  const noop = (..._a: unknown[]): void => {};
  return {
    workspaceId: "ws-test",
    secrets: {},
    fetch: globalThis.fetch,
    logger: { info: noop, warn: noop, error: noop },
    limiter: createRateLimiter({}),
    now: () => new Date("2026-09-29T00:00:00.000Z"),
  };
}

describe("createRateLimiter", () => {
  it("perMinute waits until the window passes (fake clock)", async () => {
    let t = 0;
    const limiter = createRateLimiter({
      perMinute: 2,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    });
    await limiter.acquire("k");
    await limiter.acquire("k");
    await limiter.acquire("k");
    expect(t).toBe(60_000);
    // Keys are independent.
    await limiter.acquire("other");
    expect(t).toBe(60_000);
  });

  it("perDay throws ConnectorError rate_limited when exhausted", async () => {
    const limiter = createRateLimiter({ perDay: 1, now: () => 0 });
    await limiter.acquire("k");
    await expect(limiter.acquire("k")).rejects.toMatchObject({
      name: "ConnectorError",
      code: "rate_limited",
    });
  });

  it("minIntervalMs spaces acquisitions apart", async () => {
    let t = 0;
    const limiter = createRateLimiter({
      minIntervalMs: 100,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    });
    await limiter.acquire("k");
    t = 50;
    await limiter.acquire("k");
    expect(t).toBe(100);
  });
});

describe("createRegistry", () => {
  it("registers, gets, lists, and rejects duplicates/unknowns", () => {
    const reg = createRegistry<{ kind: string; v: number }>();
    reg.register(() => ({ kind: "a", v: 1 }));
    reg.register(() => ({ kind: "b", v: 2 }));
    expect(reg.get("a")).toEqual({ kind: "a", v: 1 });
    expect(reg.kinds().sort()).toEqual(["a", "b"]);
    expect(() => reg.register(() => ({ kind: "a", v: 3 }))).toThrow();
    expect(() => reg.get("zzz")).toThrow();
  });
});

describe("statusFromError", () => {
  it("maps connector errors to connection statuses", () => {
    expect(statusFromError(new ConnectorError("x", "auth_expired"))).toBe(
      "expired",
    );
    expect(statusFromError(new ConnectorError("x", "blocked"))).toBe("blocked");
    expect(statusFromError(new ConnectorError("x", "rate_limited"))).toBe(
      "error",
    );
    expect(statusFromError(new ConnectorError("x", "bad_response"))).toBe(
      "error",
    );
    expect(statusFromError(new ConnectorError("x", "network"))).toBe("error");
    expect(statusFromError(new Error("plain"))).toBe("error");
    expect(statusFromError("string")).toBe("error");
  });
});

describe("scrubFixture + findUnscrubbed", () => {
  const sample = {
    상품명: "청송 시나노골드 사과 3kg 11과",
    url: "https://shop.example.com/p/123",
    merchantId: "019b0c53-25ae-761f-90e1-38b81e9ba716",
    공급가: 15230,
    imageUrls: ["https://cdn.shop.example.com/img/apple1.jpg?x=1"],
    contact: "010-1234-5678",
    email: "seller@shop.example.com",
    updatedAt: "2026-09-28T12:00:00.000Z",
    options: [{ optionName: "시나노골드 3kg", price: 15230, stock: 5 }],
    active: true,
    tag: null,
  };

  it("flags the raw sample", () => {
    expect(findUnscrubbed(sample).length).toBeGreaterThan(0);
  });

  it("scrubs everything findUnscrubbed checks", () => {
    const scrubbed = scrubFixture(sample) as Record<string, unknown>;
    expect(findUnscrubbed(scrubbed)).toEqual([]);
    expect(scrubbed["공급가"]).toBe(15200);
    expect(scrubbed["상품명"]).toMatch(/^item_[0-9a-f]{8} 3kg 11과$/);
    expect(scrubbed["url"]).toMatch(/^https:\/\/example\.invalid\/[0-9a-f]{8}$/);
    expect(scrubbed["merchantId"]).toMatch(/^id_[0-9a-f]{8}$/);
    const images = scrubbed["imageUrls"] as string[];
    expect(images[0]).toMatch(/^https:\/\/example\.invalid\/[0-9a-f]{8}\.jpg$/);
    expect(scrubbed["contact"]).toBe("[PHONE]");
    expect(scrubbed["email"]).toBe("[EMAIL]");
    expect(scrubbed["updatedAt"]).toBe("<date>");
    const options = scrubbed["options"] as Record<string, unknown>[];
    expect(options[0]!["optionName"]).toMatch(/^item_[0-9a-f]{8} 3kg$/);
    expect(options[0]!["price"]).toBe(15200);
    expect(options[0]!["stock"]).toBe(5);
    expect(scrubbed["active"]).toBe(true);
    expect(scrubbed["tag"]).toBeNull();
  });

  it("is deterministic per salt and varies with salt", () => {
    const a = scrubFixture(sample);
    const b = scrubFixture(sample);
    expect(a).toEqual(b);
    const c = scrubFixture(sample, { salt: "other" }) as Record<string, unknown>;
    expect(c["상품명"]).not.toBe((a as Record<string, unknown>)["상품명"]);
    expect(findUnscrubbed(c)).toEqual([]);
  });
});

describe("createFakeSupplierConnector", () => {
  const products = [
    {
      externalId: "p1",
      name: "청송 사과 3kg",
      supplyPrice: 15000,
      status: "active" as const,
      imageUrls: ["https://example.invalid/a"],
      options: [{ optionName: "3kg", price: 15000 }],
      raw: {},
    },
    {
      externalId: "p2",
      name: "포도 2kg",
      supplyPrice: null,
      status: "soldout" as const,
      imageUrls: [],
      options: [],
      raw: {},
    },
  ];

  it("filters by keyword substring and reports healthy", async () => {
    const c = createFakeSupplierConnector(products);
    const ctx = makeCtx();
    expect((await c.healthCheck(ctx)).status).toBe("ok");
    expect((await c.searchProducts(ctx, "사과")).map((p) => p.externalId)).toEqual([
      "p1",
    ]);
    expect(await c.searchProducts(ctx, "nope")).toEqual([]);
    expect(c.getOrderLink?.(ctx, "p1")).toBe("https://example.invalid/order/p1");
  });
});
