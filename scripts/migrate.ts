/**
 * CLI: npm run migrate
 * Applies all pending SQL migrations to DATABASE_URL.
 */
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../lib/migrate";
import { getPool } from "../lib/db";

/** Minimal .env loader (Next.js loads .env itself; tsx scripts do not). */
function loadEnvFile(): void {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadEnvFile();

async function main() {
  try {
    const applied = await runMigrations();
    if (applied.length === 0) {
      console.log("Database is up to date — no migrations to apply.");
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const f of applied) console.log(`  - ${f}`);
    }
  } finally {
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(`Migration failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
