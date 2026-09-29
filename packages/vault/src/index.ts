import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SealedSecret {
  v: 1;
  kid: string;
  edk: string;
  iv: string;
  tag: string;
  ct: string;
}

export interface Vault {
  kid: string;
  encrypt(plaintext: string, aad: string): SealedSecret;
  decrypt(sealed: SealedSecret, aad: string): string;
  rewrap(sealed: SealedSecret, aad: string, next: Vault): SealedSecret;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const DATA_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Raw master keys, tracked so rewrap() can rotate under a new vault's key. */
const masterKeys = new WeakMap<Vault, Buffer>();

function decodeMasterKey(masterKey: string): Buffer {
  let raw: Buffer;
  try {
    raw = Buffer.from(masterKey, "base64");
  } catch {
    throw new VaultError("invalid master key: not valid base64");
  }
  if (raw.length !== DATA_KEY_BYTES) {
    throw new VaultError(
      `invalid master key: must decode to 32 bytes, got ${raw.length}`,
    );
  }
  return raw;
}

function b64decode(field: string, name: string): Buffer {
  const buf = Buffer.from(field, "base64");
  if (buf.length === 0 && field.length > 0) {
    throw new VaultError(`invalid sealed secret: field ${name} is not valid base64`);
  }
  return buf;
}

function sealDataKey(dataKey: Buffer, masterKey: Buffer, aad: string): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function openDataKey(edk: string, masterKey: Buffer, aad: string): Buffer {
  const packed = b64decode(edk, "edk");
  if (packed.length !== GCM_IV_BYTES + GCM_TAG_BYTES + DATA_KEY_BYTES) {
    throw new VaultError("invalid sealed secret: malformed edk");
  }
  const iv = packed.subarray(0, GCM_IV_BYTES);
  const tag = packed.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES);
  const ct = packed.subarray(GCM_IV_BYTES + GCM_TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new VaultError("decrypt failed: wrong key, tampered data, or wrong aad");
  }
}

export function createVault(opts: {
  masterKey: string;
  kid?: string;
}): Vault {
  const master = decodeMasterKey(opts.masterKey);
  const kid = opts.kid ?? "k1";

  const vault: Vault = {
    kid,

    encrypt(plaintext: string, aad: string): SealedSecret {
      const dataKey = randomBytes(DATA_KEY_BYTES);
      const iv = randomBytes(GCM_IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const ct = Buffer.concat([
        cipher.update(Buffer.from(plaintext, "utf8")),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return {
        v: 1,
        kid,
        edk: sealDataKey(dataKey, master, aad),
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ct: ct.toString("base64"),
      };
    },

    decrypt(sealed: SealedSecret, aad: string): string {
      if (sealed.v !== 1) {
        throw new VaultError("decrypt failed: unsupported sealed version");
      }
      if (sealed.kid !== kid) {
        throw new VaultError(
          `decrypt failed: kid mismatch (want ${kid}, got ${sealed.kid})`,
        );
      }
      const dataKey = openDataKey(sealed.edk, master, aad);
      if (dataKey.length !== DATA_KEY_BYTES) {
        throw new VaultError("decrypt failed: malformed data key");
      }
      // GCM은 짧게 잘린 태그도 받아들이므로 길이를 직접 고정한다.
      const tag = b64decode(sealed.tag, "tag");
      if (tag.length !== GCM_TAG_BYTES) {
        throw new VaultError("decrypt failed: malformed auth tag");
      }
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          dataKey,
          b64decode(sealed.iv, "iv"),
          { authTagLength: GCM_TAG_BYTES },
        );
        decipher.setAuthTag(tag);
        decipher.setAAD(Buffer.from(aad, "utf8"));
        const pt = Buffer.concat([
          decipher.update(b64decode(sealed.ct, "ct")),
          decipher.final(),
        ]);
        return pt.toString("utf8");
      } catch (err) {
        if (err instanceof VaultError) throw err;
        throw new VaultError("decrypt failed: wrong key, tampered data, or wrong aad");
      }
    },

    rewrap(sealed: SealedSecret, aad: string, next: Vault): SealedSecret {
      const nextKey = masterKeys.get(next);
      if (nextKey === undefined) {
        // Foreign Vault implementation: fall back to decrypt + encrypt.
        // (ct changes in this path; own vaults keep ct stable.)
        return next.encrypt(vault.decrypt(sealed, aad), aad);
      }
      if (sealed.v !== 1) {
        throw new VaultError("rewrap failed: unsupported sealed version");
      }
      if (sealed.kid !== kid) {
        throw new VaultError("rewrap failed: kid mismatch");
      }
      const dataKey = openDataKey(sealed.edk, master, aad);
      return {
        v: sealed.v,
        kid: next.kid,
        edk: sealDataKey(dataKey, nextKey, aad),
        iv: sealed.iv,
        tag: sealed.tag,
        ct: sealed.ct,
      };
    },
  };

  masterKeys.set(vault, master);
  return vault;
}

export function generateMasterKey(): string {
  return randomBytes(DATA_KEY_BYTES).toString("base64");
}

const BULLET = "••••";

export function mask(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const chars = Array.from(value);
  if (chars.length <= 4) return BULLET;
  return BULLET + chars.slice(-4).join("");
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_RE =
  /pass(word)?|secret|token|cookie|session|api[-_]?key|access[-_]?license|authorization|client[-_]?secret|private|phone|mobile|tel|address|addr|주소|연락처|전화|수취인|receiver|recipient/i;

const REDACTED = "[REDACTED]";
const PHONE_RE = /01[016789]-?\d{3,4}-?\d{4}/g;
const BEARER_RE = /Bearer\s+[^\s]+/g;

function redactStringValue(s: string, knownSecrets: string[]): string {
  let out = s.replace(BEARER_RE, `Bearer ${REDACTED}`);
  for (const secret of knownSecrets) {
    if (secret.length < 4) continue;
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(PHONE_RE, "[PHONE]");
  return out;
}

export function redact<T>(input: T, opts?: { knownSecrets?: string[] }): T {
  const knownSecrets = opts?.knownSecrets ?? [];
  const seen = new Map<object, unknown>();

  const visit = (node: unknown): unknown => {
    if (
      node === null ||
      node === undefined ||
      typeof node === "number" ||
      typeof node === "boolean" ||
      typeof node === "bigint"
    ) {
      return node;
    }
    if (typeof node === "string") {
      return redactStringValue(node, knownSecrets);
    }
    if (typeof node !== "object") {
      return node;
    }
    const cached = seen.get(node);
    if (cached !== undefined) return cached;

    if (node instanceof Date) {
      const copy = new Date(node.getTime());
      seen.set(node, copy);
      return copy;
    }
    if (node instanceof Error) {
      const copy = new Error(redactStringValue(node.message, knownSecrets));
      copy.name = node.name;
      if (node.stack !== undefined) copy.stack = node.stack;
      seen.set(node, copy);
      for (const key of Object.keys(node)) {
        if (key === "message" || key === "stack") continue;
        (copy as unknown as Record<string, unknown>)[key] = visit(
          (node as unknown as Record<string, unknown>)[key],
        );
      }
      return copy;
    }
    if (Array.isArray(node)) {
      const copy: unknown[] = [];
      seen.set(node, copy);
      for (const item of node) copy.push(visit(item));
      return copy;
    }
    if (node instanceof Map) {
      const copy = new Map<unknown, unknown>();
      seen.set(node, copy);
      for (const [k, v] of node) copy.set(visit(k), visit(v));
      return copy;
    }
    if (node instanceof Set) {
      const copy = new Set<unknown>();
      seen.set(node, copy);
      for (const item of node) copy.add(visit(item));
      return copy;
    }
    const copy: Record<string, unknown> = Object.create(
      Object.getPrototypeOf(node),
    );
    seen.set(node, copy);
    for (const [key, value] of Object.entries(node)) {
      copy[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : visit(value);
    }
    return copy;
  };

  return visit(input) as T;
}

export function createRedactingLogger(
  base?: Pick<Console, "info" | "warn" | "error">,
  opts?: { knownSecrets?: string[] },
): {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
} {
  const target: Pick<Console, "info" | "warn" | "error"> = base ?? console;
  const wrap =
    (fn: (...a: unknown[]) => void) =>
    (...a: unknown[]): void => {
      fn(...(redact(a, opts) as unknown[]));
    };
  return {
    info: wrap((...a) => target.info(...a)),
    warn: wrap((...a) => target.warn(...a)),
    error: wrap((...a) => target.error(...a)),
  };
}
