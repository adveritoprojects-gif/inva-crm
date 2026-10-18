import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AppError, ForbiddenError, PayloadTooLargeError, UnauthorizedError } from "./errors";
import { SetupError } from "./db";
import { getSessionFromToken, isAllowedOrigin, SESSION_COOKIE } from "./auth";

/** Payload cap for JSON restore uploads (matches the UI's 20 MB limit). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface ErrorBody {
  error: string;
  message: string;
  issues?: unknown;
}

/** Converts any thrown error into a JSON response with a useful message. */
export function errorResponse(err: unknown): NextResponse<ErrorBody> {
  if (err instanceof SetupError) {
    return NextResponse.json(
      { error: "unavailable", message: err.message },
      { status: 503 }
    );
  }
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) },
      { status: err.status }
    );
  }
  const message =
    err instanceof Error ? err.message : "Unexpected server error.";
  // Log server-side but never leak SQL/connection details to the client.
  console.error("[api] error:", message);
  return NextResponse.json(
    { error: "server_error", message: "Something went wrong while processing the request." },
    { status: 500 }
  );
}

/** Enforces same-origin on write requests; throws 403 on cross-site requests. */
export function assertSameOrigin(req: NextRequest): void {
  if (!isAllowedOrigin(req)) {
    throw new ForbiddenError();
  }
}

/** Requires a valid session cookie; throws 401 otherwise. */
export async function requireSession(req: NextRequest): Promise<{ id: string }> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSessionFromToken(token);
  if (!session) throw new UnauthorizedError();
  return session;
}

/** Reads and parses a JSON body with a hard byte cap. */
export async function readJsonBody<T = unknown>(req: NextRequest): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError();
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError(400, "bad_request", "Request body must be valid JSON.");
  }
}
