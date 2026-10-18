import type { NextRequest } from "next/server";
import { NextRequest as NR } from "next/server";
import crypto from "node:crypto";

/**
 * Shared helpers for integration tests.
 * Tests run against TEST_DATABASE_URL only — never a production database.
 */

/** Returns the test database URL, or null when it is not configured. */
export function getTestDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (!/test/i.test(parsed.pathname)) {
    throw new Error(
      `Refusing to use "${parsed.pathname.replace(/^\//, "")}" as a test database. ` +
        "TEST_DATABASE_URL must point at a database whose name contains 'test' " +
        "(e.g. postgresql://user:pass@localhost:5432/pct_crm_test)."
    );
  }
  return url;
}

/** Drops and recreates the public schema on the test database. */
export async function freshTestDatabase(url: string): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
    );
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

export function makeRequest(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    cookie?: string | null;
    origin?: string | null;
    ip?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.origin !== undefined && init.origin !== null) headers.set("origin", init.origin);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.ip) headers.set("x-forwarded-for", init.ip);
  const body =
    init.rawBody !== undefined
      ? init.rawBody
      : init.body !== undefined
        ? JSON.stringify(init.body)
        : undefined;
  if (body !== undefined && init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("content-length", String(Buffer.byteLength(body, "utf8")));
  }
  return new NR(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });
}

/** Builds a valid raw project record for requests/backups. */
export function rawProject(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    number: "PCT-1001",
    title: "Thesis on renewable energy",
    student: "Asha Patel",
    phone: "00441234567890",
    university: "Oxford College",
    writer: "Ravi Kumar",
    words: 5000,
    received: "2026-01-05",
    due: "2026-02-05",
    status: "In progress",
    percent: 40,
    pending: "Chapter 3 outline",
    notes: "Use APA 7th edition.",
    total: 15000.5,
    paid: 5000,
    writerTotal: 6000,
    writerPaid: 2000,
    revisions: [],
    ...overrides,
  };
}

export function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /pct_session=([^;]+)/.exec(setCookie);
  if (!m) throw new Error("Expected a pct_session cookie on the response.");
  return `pct_session=${m[1]}`;
}
