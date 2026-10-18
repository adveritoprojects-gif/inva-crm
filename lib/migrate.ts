import fs from "node:fs/promises";
import path from "node:path";
import { getPool } from "./db";

/**
 * Versioned SQL migration runner.
 * - Applies db/migrations/*.sql in filename order, once each.
 * - Each migration runs inside its own transaction.
 * - A PostgreSQL advisory lock serializes concurrent runners.
 * - Records applied versions in schema_migrations (created if missing).
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const ADVISORY_LOCK_KEY = 728_193_554; // arbitrary fixed key for this app

export async function runMigrations(): Promise<string[]> {
  const dir = MIGRATIONS_DIR;
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

    const doneRes = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations"
    );
    const done = new Set(doneRes.rows.map((r) => r.version));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${file} failed: ${(err as Error).message}`
        );
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    } catch {
      /* lock is released with the session regardless */
    }
    client.release();
  }
  return applied;
}

// Lazily ensure migrations have run once per process. This keeps `next dev`
// and tests working without a manual step while `npm run migrate` remains the
// explicit production command. A build never triggers this (no DB access).
let migratePromise: Promise<string[]> | null = null;

export function ensureMigrated(): Promise<string[]> {
  if (!migratePromise) {
    migratePromise = runMigrations().catch((err) => {
      migratePromise = null; // allow retry after a transient failure
      throw err;
    });
  }
  return migratePromise;
}
