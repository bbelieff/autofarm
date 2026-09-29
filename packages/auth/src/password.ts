import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 1 << 15;
const r = 8;
const p = 1;
const KEYLEN = 64;

function scryptAsync(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pw, salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export const MIN_PASSWORD_LENGTH = 4;

/** 형식: scrypt$N$r$p$salt(b64)$hash(b64) */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`);
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const key = await scryptAsync(password, salt);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
