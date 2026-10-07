import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appSecret } from "./config";

function key(purpose: string): Buffer {
  return createHash("sha256").update(`${purpose}:${appSecret()}`).digest();
}

/** Encrypts a string with AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(data) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("tokens"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key("tokens"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  const mac = createHmac("sha256", key("cookies")).update(value).digest("base64url");
  return `${value}.${mac}`;
}

/** Returns the original value if the signature is valid, otherwise null. */
export function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(signed);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return value;
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}
