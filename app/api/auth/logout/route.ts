import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { SESSION_COOKIE, clearSessionCookie, destroySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 * Server-side session invalidation plus cookie removal.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await destroySession(req.cookies.get(SESSION_COOKIE)?.value);
    const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    const res = errorResponse(err);
    clearSessionCookie(res);
    return res;
  }
}
