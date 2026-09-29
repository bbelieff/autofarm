import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findUnscrubbed } from "../src";

// 레포 안의 모든 fixtures/**/*.json 은 스크러버를 거친 것이어야 한다(공개 레포 — 실제 상품명·URL·ID 금지).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP = new Set(["node_modules", ".git", ".next", ".pgdata", "storage"]);

function fixtureFiles(dir: string, inFixtures = false, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) fixtureFiles(p, inFixtures || name === "fixtures", out);
    else if (inFixtures && name.endsWith(".json")) out.push(p);
  }
  return out;
}

describe("공개 레포 픽스처 검사", () => {
  const files = fixtureFiles(root);
  it("모든 픽스처가 스크러버를 거쳤다", () => {
    const problems = files.flatMap((f) =>
      findUnscrubbed(JSON.parse(readFileSync(f, "utf8"))).map((p) => `${path.relative(root, f)}: ${p}`),
    );
    expect(problems).toEqual([]);
  });
});
