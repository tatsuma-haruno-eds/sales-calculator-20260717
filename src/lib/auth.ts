import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "mortgage-session";

function getSigningSecret() {
  const secret = process.env.SESSION_SECRET || process.env.APP_ACCESS_PASSCODE;
  if (!secret) throw new Error("APP_ACCESS_PASSCODE is not configured.");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

export function verifyPasscode(candidate: string) {
  const expected = process.env.APP_ACCESS_PASSCODE;
  if (!expected) return false;
  const candidateHash = createHmac("sha256", "passcode-check").update(candidate).digest();
  const expectedHash = createHmac("sha256", "passcode-check").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function createSessionToken() {
  const payload = `v1.${randomBytes(32).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token || !process.env.APP_ACCESS_PASSCODE) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[\w-]{43}$/.test(parts[1])) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expectedSignature = Buffer.from(sign(payload));
  const suppliedSignature = Buffer.from(parts[2]);
  return expectedSignature.length === suppliedSignature.length
    && timingSafeEqual(expectedSignature, suppliedSignature);
}
