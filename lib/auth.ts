import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SetupError, query, withTransaction } from "./db";
import { ensureMigrated } from "./migrate";

/**
 * Single-owner authentication.
 * - Salted scrypt password hashing with timing-safe comparison.
 * - Random session tokens; only their SHA-256 hashes are stored.
 * - 8-hour expiry, HttpOnly/SameSite cookie, Secure on HTTPS.
 * - Sessions are invalidated automatically when ADMIN_PASSWORD_HASH changes
 *   (the current hash's fingerprint is stored on each session).
 * - Login throttle: 10 attempts per 15 minutes, updated atomically.
 */

export const SESSION_COOKIE = "pct_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
export const MAX_LOGIN_ATTEMPTS = 10;
export const LOGIN_WINDOW_MINUTES = 15;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

/** Creates a `scrypt$<salt-b64>$<hash-b64>` string for ADMIN_PASSWORD_HASH. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

function getPasswordHash(): string {
  const hash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!hash) {
    throw new SetupError(
      "ADMIN_PASSWORD_HASH is not configured. Run `npm run setup` or generate a hash with " +
        "`node scripts/hash-password.mjs 'your-password'` and add it to .env. See README.md."
    );
  }
  return hash;
}

/** Timing-safe verification of a password against the stored scrypt hash. */
export async function verifyPassword(password: string): Promise<boolean> {
  const stored = getPasswordHash();
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    throw new SetupError(
      "ADMIN_PASSWORD_HASH is malformed. Expected the format `scrypt$<salt>$<hash>`. " +
        "Regenerate it with `node scripts/hash-password.mjs 'your-password'`."
    );
  }
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = await scryptAsync(password, salt);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** Fingerprint of the configured password hash, used to revoke stale sessions. */
export function authFingerprint(): string {
  return crypto.createHash("sha256").update(getPasswordHash()).digest("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface SessionRecord {
  id: string;
  expiresAt: Date;
}

/** Creates a session row and returns the opaque token (not stored in plain form). */
export async function createSession(): Promise<{ token: string; expiresAt: Date }> {
  await ensureMigrated();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await query(
    `INSERT INTO sessions (id, token_hash, auth_fingerprint, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), hashToken(token), authFingerprint(), expiresAt]
  );
  return { token, expiresAt };
}

/** Verifies a session token; returns null when missing/expired/revoked. */
export async function getSessionFromToken(
  token: string | undefined
): Promise<SessionRecord | null> {
  if (!token) return null;
  await ensureMigrated();
  const rows = await query<{ id: string; expires_at: Date }>(
    `SELECT id, expires_at FROM sessions
      WHERE token_hash = $1 AND expires_at > now() AND auth_fingerprint = $2`,
    [hashToken(token), authFingerprint()]
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, expiresAt: rows[0].expires_at };
}

/** Deletes a session (logout). */
export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

/** Housekeeping: remove expired sessions. */
export async function cleanupExpiredSessions(): Promise<number> {
  const rows = await query<{ id: string }>(
    "DELETE FROM sessions WHERE expires_at <= now() RETURNING id"
  );
  return rows.length;
}

export function isSecureOrigin(): boolean {
  const origin = process.env.APP_ORIGIN ?? "";
  return origin.startsWith("https://");
}

/** Cookie options shared by login and logout. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureOrigin(),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// --- Origin (CSRF) protection ------------------------------------------------

/**
 * Rejects cross-site sign-in and write requests. When an Origin header is
 * present it must equal APP_ORIGIN; Sec-Fetch-Site must be same-origin/none.
 * Non-browser clients without Origin/Sec-Fetch-Site are allowed (they are not
 * subject to CSRF).
 */
export function isAllowedOrigin(req: NextRequest): boolean {
  let configured: string;
  try {
    configured = new URL(process.env.APP_ORIGIN ?? "").origin;
  } catch {
    throw new SetupError(
      "APP_ORIGIN is not configured or invalid. Set it in .env, e.g. APP_ORIGIN=http://localhost:3000."
    );
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== configured) return false;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  return true;
}

// --- Login throttle ----------------------------------------------------------

export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return `login:${ip}`;
}

export interface ThrottleResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Atomically records a login attempt and reports whether it is allowed.
 * A transaction-scoped advisory lock serializes concurrent attempts for the
 * same key so the count cannot be raced past the limit.
 */
export async function recordLoginAttempt(key: string): Promise<ThrottleResult> {
  await ensureMigrated();
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);

    // Opportunistic cleanup of very old rows.
    await client.query(
      "DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day'"
    );

    const res = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM login_attempts
        WHERE attempt_key = $1 AND attempted_at > now() - ($2 || ' minutes')::interval`,
      [key, String(LOGIN_WINDOW_MINUTES)]
    );
    const used = Number(res.rows[0]?.count ?? "0");
    if (used >= MAX_LOGIN_ATTEMPTS) {
      const oldest = await client.query<{ waited: string }>(
        `SELECT extract(epoch FROM (min(attempted_at) + ($2 || ' minutes')::interval - now()))::text AS waited
           FROM login_attempts WHERE attempt_key = $1`,
        [key, String(LOGIN_WINDOW_MINUTES)]
      );
      const retry = Math.max(1, Math.ceil(Number(oldest.rows[0]?.waited ?? LOGIN_WINDOW_MINUTES * 60)));
      return { allowed: false, remaining: 0, retryAfterSeconds: retry };
    }

    await client.query("INSERT INTO login_attempts (attempt_key) VALUES ($1)", [key]);
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - used - 1, retryAfterSeconds: 0 };
  });
}

/** Clears recorded attempts after a successful sign-in. */
export async function clearLoginAttempts(key: string): Promise<void> {
  await query("DELETE FROM login_attempts WHERE attempt_key = $1", [key]);
}

/** Applies the session cookie to a response. */
export function setSessionCookie(res: NextResponse, token: string): void {
  const opts = sessionCookieOptions(SESSION_TTL_SECONDS);
  res.cookies.set({ ...opts, value: token });
}

export function clearSessionCookie(res: NextResponse): void {
  const opts = sessionCookieOptions(0);
  res.cookies.set({ ...opts, value: "" });
}
