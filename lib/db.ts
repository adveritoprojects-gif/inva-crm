import { Pool, types, type PoolClient } from "pg";
import fs from "node:fs";

/**
 * PostgreSQL access for PCT Project Desk.
 * - Node.js runtime only (never the Edge runtime).
 * - Lazy initialization so `next build` never needs a live database.
 * - A single bounded pool is reused across Next.js dev hot reloads via globalThis.
 */

/** Clear, actionable error for missing/broken configuration (HTTP 503). */
export class SetupError extends Error {
  readonly code = "unavailable";
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

// Keep date-only columns as plain 'YYYY-MM-DD' strings so values never shift
// through UTC (node-postgres would otherwise parse DATE into a JS Date in local
// time). Money (numeric) stays an exact string; conversions happen in app code.
types.setTypeParser(1082, (v: string) => v); // DATE
types.setTypeParser(20, (v: string) => v); // INT8 as string

interface PooledSsl {
  rejectUnauthorized: boolean;
  ca?: Buffer;
}

function buildSslConfig(): PooledSsl | undefined {
  const raw = process.env.DATABASE_URL ?? "";
  let sslmode: string | null = null;
  try {
    sslmode = new URL(raw).searchParams.get("sslmode");
  } catch {
    sslmode = null;
  }
  const caPath = process.env.PCT_PG_SSL_CA;
  const ca = caPath ? fs.readFileSync(caPath) : undefined;

  if (sslmode === "disable") return undefined;
  if (sslmode === "require") return { rejectUnauthorized: false, ca };
  if (sslmode === "verify-ca") return { rejectUnauthorized: false, ca };
  if (sslmode === "verify-full") return { rejectUnauthorized: true, ca };

  // No sslmode specified: treat non-local hosts as hosted TLS with proper
  // certificate verification. Never disable verification globally here.
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!local) return { rejectUnauthorized: true, ca };
  } catch {
    /* fall through: malformed URL is reported by the pool on first connect */
  }
  return undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new SetupError(
      "DATABASE_URL is not configured. Copy .env.example to .env, create a PostgreSQL database, " +
        "set DATABASE_URL, then run `npm run migrate`. See README.md for details."
    );
  }
  const max = Number(process.env.PG_POOL_MAX ?? 10);
  const pool = new Pool({
    connectionString,
    max: Number.isFinite(max) && max > 0 ? Math.min(max, 50) : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: buildSslConfig(),
    application_name: "pct-crm",
  });
  // Do not leak connection strings or credentials in logs.
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  return pool;
}

/** Returns the shared pool, creating it on first use (dev-reload safe). */
export function getPool(): Pool {
  const g = globalThis as typeof globalThis & { __pctPool?: Pool };
  if (!g.__pctPool) g.__pctPool = createPool();
  return g.__pctPool;
}

/** Reset the cached pool (used by tests between databases). */
export function resetPool(): void {
  const g = globalThis as typeof globalThis & { __pctPool?: Pool };
  if (g.__pctPool) {
    const p = g.__pctPool;
    g.__pctPool = undefined as unknown as Pool;
    void p.end().catch(() => {});
  }
}

/**
 * Runs `fn` inside a single transaction on one checked-out client.
 * Rolls back on failure and always releases the client.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may already be broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Convenience wrapper for a single read query on the pool. */
export async function query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as unknown[]);
  return res.rows;
}
