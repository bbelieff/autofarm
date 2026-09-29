import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deepMerge, loadPresets, loadSupplierSeeds } from "../src";

const repoConfig = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config");
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "af-cfg-"));

describe("프리셋", () => {
  it("example 만 있어도 읽히고 주석 키는 버린다", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "presets.example.json"), JSON.stringify({ _comment: "x", timing: { entryPercent: 25, leadDays: 5 } }));
    const r = loadPresets(dir);
    expect(r.source).toBe("example");
    expect(r.presets.timing.entryPercent).toBe(25);
    expect("_comment" in (r.presets as object)).toBe(false);
  });

  it("private 가 example 을 덮어쓴다", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "presets.example.json"), JSON.stringify({ channels: { daangn: { feeRate: 0.033, minPeakSearch: 0 } } }));
    writeFileSync(path.join(dir, "presets.private.json"), JSON.stringify({ channels: { daangn: { minPeakSearch: 30000 } } }));
    const r = loadPresets(dir);
    expect(r.source).toBe("private");
    expect(r.presets.channels.daangn).toEqual({ feeRate: 0.033, minPeakSearch: 30000 });
  });

  it("레포의 example 파일이 읽힌다", () => {
    expect(loadPresets(repoConfig).presets.timing.entryPercent).toBe(25);
  });

  it("배열은 통째로 바꾸고 객체는 합친다", () => {
    expect(deepMerge({ a: [1, 2], b: { c: 1 } }, { a: [3], b: { d: 2 } })).toEqual({ a: [3], b: { c: 1, d: 2 } });
  });
});

describe("공급처 시드", () => {
  it("파일이 없으면 빈 배열", () => {
    expect(loadSupplierSeeds(tmp())).toEqual([]);
  });

  it("name·platform 이 없으면 오류", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "suppliers.private.json"), JSON.stringify([{ name: "A", platform: "adminplus" }, { name: "B" }]));
    expect(() => loadSupplierSeeds(dir)).toThrow();
  });
});
