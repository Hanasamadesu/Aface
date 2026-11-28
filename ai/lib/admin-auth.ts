import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE_NAME = "aface_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

interface AdminTokenPayload {
  role: "admin";
  exp: number;
}

function getAdminPassword(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.trim().length === 0) {
    return null;
  }
  return password;
}

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret && secret.trim().length > 0) {
    return secret;
  }
  const password = getAdminPassword() ?? "unconfigured";
  return crypto
    .createHash("sha256")
    .update(`aface-admin-session:${password}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function isAdminConfigured(): boolean {
  return getAdminPassword() !== null;
}

export function verifyAdminPassword(candidate: string): boolean {
  const expected = getAdminPassword();
  if (!expected || !candidate) {
    return false;
  }
  return safeEqual(candidate, expected);
}

export function createAdminSessionToken(): string {
  const payload: AdminTokenPayload = {
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyAdminSessionToken(token: string | undefined): boolean {
  if (!token || !isAdminConfigured()) {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return false;
  }
  const expectedSignature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");

  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<AdminTokenPayload>;
    if (parsed.role !== "admin" || typeof parsed.exp !== "number") {
      return false;
    }
    return parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return verifyAdminSessionToken(token);
}

export function shouldUseSecureCookie(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export const ADMIN_SESSION_MAX_AGE = SESSION_TTL_SECONDS;
