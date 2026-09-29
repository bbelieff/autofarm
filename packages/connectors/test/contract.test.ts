import {
  createFakeSupplierConnector,
  createRateLimiter,
} from "../src/index";
import type {
  ConnectorContext,
  SupplierProductRaw,
} from "../src/index";
import { runSupplierContract } from "../src/testing";

const products: SupplierProductRaw[] = [
  {
    externalId: "fake-1",
    name: "사과 3kg",
    url: "https://example.invalid/fake-1",
    supplyPrice: 15000,
    shippingFee: 3000,
    status: "active",
    stock: 10,
    imageUrls: ["https://example.invalid/fake-1.jpg"],
    options: [{ optionName: "사과 3kg", price: 15000, stock: 10 }],
    raw: { note: "fixture" },
  },
];

function makeCtx(): ConnectorContext {
  const noop = (..._a: unknown[]): void => {};
  return {
    workspaceId: "ws-contract",
    secrets: {},
    fetch: globalThis.fetch,
    logger: { info: noop, warn: noop, error: noop },
    limiter: createRateLimiter({}),
    now: () => new Date("2026-09-29T00:00:00.000Z"),
  };
}

runSupplierContract(
  "manual-fake",
  () => createFakeSupplierConnector(products),
  makeCtx,
  "사과",
);
