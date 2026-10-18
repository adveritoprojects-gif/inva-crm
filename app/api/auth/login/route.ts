import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/lib/http";
import {
  clearLoginAttempts,
  cleanupExpiredSessions,
  clientKey,
  createSession,
  recordLoginAttempt,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { BadRequestError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 * Body: { password: string }
 * Single-owner sign-in with origin protection and an atomic throttle
 * (10 attempts per 15 minutes).
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);

    const body = await readJsonBody<{ password?: unknown }>(req);
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) throw new BadRequestError("Password is required.");

    const key = clientKey(req);
    const throttle = await recordLoginAttempt(key);
    if (!throttle.allowed) {
      const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          error: "too_many_attempts",
          message: `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
      );
    }

    const valid = await verifyPassword(password);
    if (!valid) {
      return NextResponse.json(
        { error: "invalid_credentials", message: "Incorrect password." },
        { status: 401 }
      );
    }

    await clearLoginAttempts(key);
    await cleanupExpiredSessions();
    const { token } = await createSession();

    const res = NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
