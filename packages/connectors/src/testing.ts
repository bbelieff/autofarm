import { describe, expect, it } from "vitest";
import type {
  ConnectorContext,
  SupplierConnector,
  SupplierProductRaw,
} from "./index";

const VALID_STATUSES = ["unset", "ok", "expired", "blocked", "error"];
const VALID_PRODUCT_STATUSES = ["active", "soldout", "inactive", "unknown"];

function assertProductShape(p: SupplierProductRaw): void {
  expect(typeof p.externalId).toBe("string");
  expect(p.externalId.length).toBeGreaterThan(0);
  expect(typeof p.name).toBe("string");
  expect(p.name.length).toBeGreaterThan(0);
  expect(
    typeof p.supplyPrice === "number" || p.supplyPrice === null,
  ).toBe(true);
  expect(Array.isArray(p.imageUrls)).toBe(true);
  expect(Array.isArray(p.options)).toBe(true);
  for (const o of p.options) {
    expect(typeof o.optionName).toBe("string");
    expect(typeof o.price).toBe("number");
  }
}

/**
 * Supplier connector contract tests. Call once per connector from a
 * `*.test.ts` file, e.g. `runSupplierContract("manual", makeFake, makeCtx, "사과")`.
 */
export function runSupplierContract(
  label: string,
  make: () => SupplierConnector,
  ctx: () => ConnectorContext,
  keyword: string,
): void {
  describe(`supplier contract: ${label}`, () => {
    it("healthCheck returns a valid status and Date", async () => {
      const connector = make();
      const result = await connector.healthCheck(ctx());
      expect(VALID_STATUSES).toContain(result.status);
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it("searchProducts returns well-shaped products", async () => {
      const connector = make();
      const products = await connector.searchProducts(ctx(), keyword);
      expect(Array.isArray(products)).toBe(true);
      for (const p of products) {
        expect(VALID_PRODUCT_STATUSES).toContain(p.status);
        assertProductShape(p);
      }
    });
  });
}
