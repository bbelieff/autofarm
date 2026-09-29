import { describe, expect, it, vi } from "vitest";
import {
  createRedactingLogger,
  createVault,
  generateMasterKey,
  mask,
  redact,
  VaultError,
} from "../src/index";

describe("vault envelope encryption", () => {
  it("roundtrips plaintext with matching aad", () => {
    const v = createVault({ masterKey: generateMasterKey() });
    const sealed = v.encrypt("hello 기대출", "ctx-1");
    expect(sealed.v).toBe(1);
    expect(sealed.kid).toBe("k1");
    expect(v.decrypt(sealed, "ctx-1")).toBe("hello 기대출");
  });

  it("uses a fresh random data key per call", () => {
    const v = createVault({ masterKey: generateMasterKey() });
    const a = v.encrypt("same", "aad");
    const b = v.encrypt("same", "aad");
    expect(a.ct).not.toBe(b.ct);
    expect(a.edk).not.toBe(b.edk);
  });

  it("fails on wrong aad", () => {
    const v = createVault({ masterKey: generateMasterKey() });
    const sealed = v.encrypt("secret", "right");
    expect(() => v.decrypt(sealed, "wrong")).toThrow(VaultError);
  });

  it("fails on tampered ct and tag", () => {
    const v = createVault({ masterKey: generateMasterKey() });
    const sealed = v.encrypt("secret", "aad");
    const ctBytes = Buffer.from(sealed.ct, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    expect(() =>
      v.decrypt(
        { ...sealed, ct: ctBytes.toString("base64") },
        "aad",
      ),
    ).toThrow(VaultError);
    const tagBytes = Buffer.from(sealed.tag, "base64");
    tagBytes[0] = tagBytes[0]! ^ 0xff;
    expect(() =>
      v.decrypt({ ...sealed, tag: tagBytes.toString("base64") }, "aad"),
    ).toThrow(VaultError);
  });

  it("fails with a different master key and on kid mismatch", () => {
    const a = createVault({ masterKey: generateMasterKey(), kid: "k1" });
    const b = createVault({ masterKey: generateMasterKey(), kid: "k1" });
    const sealed = a.encrypt("secret", "aad");
    expect(() => b.decrypt(sealed, "aad")).toThrow(VaultError);
    const c = createVault({ masterKey: generateMasterKey(), kid: "k2" });
    expect(() => c.decrypt(sealed, "aad")).toThrow(VaultError);
  });

  it("rewraps to a new vault keeping ct, old vault then fails", () => {
    const oldV = createVault({ masterKey: generateMasterKey(), kid: "k1" });
    const newV = createVault({ masterKey: generateMasterKey(), kid: "k2" });
    const sealed = oldV.encrypt("rotate me", "aad");
    const rotated = oldV.rewrap(sealed, "aad", newV);
    expect(rotated.ct).toBe(sealed.ct);
    expect(rotated.kid).toBe("k2");
    expect(newV.decrypt(rotated, "aad")).toBe("rotate me");
    expect(() => oldV.decrypt(rotated, "aad")).toThrow(VaultError);
  });

  it("throws on invalid master key length", () => {
    expect(() =>
      createVault({ masterKey: Buffer.from("short").toString("base64") }),
    ).toThrow(VaultError);
    expect(() =>
      createVault({ masterKey: Buffer.alloc(33).toString("base64") }),
    ).toThrow(VaultError);
  });
});

describe("mask", () => {
  it("masks values", () => {
    expect(mask("")).toBe("");
    expect(mask(null)).toBe("");
    expect(mask(undefined)).toBe("");
    expect(mask("1234")).toBe("••••");
    expect(mask("ab")).toBe("••••");
    expect(mask("01012345678")).toBe("••••5678");
  });
});

describe("redact", () => {
  it("redacts sensitive keys in nested objects and arrays", () => {
    const input = {
      user: "kim",
      password: "hunter2",
      nested: { apiKey: "abc123", deep: [{ token: "tok", keep: 42 }] },
      count: 7,
      active: true,
    };
    const out = redact(input);
    expect(out.user).toBe("kim");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.deep[0]!.token).toBe("[REDACTED]");
    expect(out.nested.deep[0]!.keep).toBe(42);
    expect(out.count).toBe(7);
    expect(out.active).toBe(true);
    // input untouched
    expect(input.password).toBe("hunter2");
  });

  it("redacts known secrets, phones, and bearer tokens inside strings", () => {
    const out = redact(
      {
        url: "https://shop.example.com/order?key=s3cr3t-value",
        contact: "010-1234-5678",
        auth: "Bearer abcdef12345",
      },
      { knownSecrets: ["s3cr3t-value"] },
    );
    expect(out.url).toBe("https://shop.example.com/order?key=[REDACTED]");
    expect(out.contact).toBe("[PHONE]");
    expect(out.auth).toBe("Bearer [REDACTED]");
  });

  it("redacts buyer PII keys and error messages", () => {
    const out = redact({
      receiver: "홍길동",
      address: "서울시 어딘가",
      err: new Error("failed for 010-9876-5432"),
    });
    expect(out.receiver).toBe("[REDACTED]");
    expect(out.address).toBe("[REDACTED]");
    expect(out.err).toBeInstanceOf(Error);
    expect(out.err.message).toBe("failed for [PHONE]");
  });

  it("handles cycles without hanging", () => {
    const cyc: Record<string, unknown> = { password: "x" };
    cyc.self = cyc;
    const out = redact(cyc);
    expect(out.password).toBe("[REDACTED]");
    expect(out.self).toBe(out);
  });
});

describe("createRedactingLogger", () => {
  it("passes redacted args to the base logger", () => {
    const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const log = createRedactingLogger(base, { knownSecrets: ["s3cr3t"] });
    log.info({ password: "pw", note: "has s3cr3t inside" });
    log.warn("plain");
    log.error("call 010-1111-2222");
    expect(base.info).toHaveBeenCalledWith({
      password: "[REDACTED]",
      note: "has [REDACTED] inside",
    });
    expect(base.warn).toHaveBeenCalledWith("plain");
    expect(base.error).toHaveBeenCalledWith("call [PHONE]");
  });
});

describe("auth tag length", () => {
  it("rejects a truncated tag", () => {
    const v = createVault({ masterKey: generateMasterKey() });
    const s = v.encrypt("secret-value", "ws|kind");
    const short = Buffer.from(s.tag, "base64").subarray(0, 8).toString("base64");
    expect(() => v.decrypt({ ...s, tag: short }, "ws|kind")).toThrow(VaultError);
  });
});
