#!/usr/bin/env node
/**
 * npm run setup
 * Prepares .env for PCT Project Desk WITHOUT overwriting existing settings:
 *  - creates .env from .env.example only when .env does not exist yet;
 *  - generates a random owner password + scrypt hash ONLY when
 *    ADMIN_PASSWORD_HASH is missing or empty (printed once, never silently);
 *  - never regenerates or replaces an existing password hash or DATABASE_URL.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

function getEnvValue(content, key) {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = re.exec(content);
  return m ? m[1].trim() : null;
}

function setEnvValue(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    return content.replace(re, `${key}=${value}`);
  }
  const trimmed = content.replace(/\n*$/, "\n");
  return `${trimmed}${key}=${value}\n`;
}

let created = false;
let content = "";

if (fs.existsSync(envPath)) {
  content = fs.readFileSync(envPath, "utf8");
  console.log("Found existing .env — existing values are preserved.");
} else if (fs.existsSync(examplePath)) {
  content = fs.readFileSync(examplePath, "utf8");
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  created = true;
  console.log("Created .env from .env.example (file permissions 600).");
} else {
  console.error(".env.example is missing; cannot create .env.");
  process.exit(1);
}

const changed = [];

// Owner password: generate only when missing. Never overwrite an existing hash.
const currentHash = getEnvValue(content, "ADMIN_PASSWORD_HASH");
if (!currentHash) {
  const password = crypto.randomBytes(12).toString("base64url");
  const hash = scryptHash(password);
  content = setEnvValue(content, "ADMIN_PASSWORD_HASH", hash);
  changed.push("ADMIN_PASSWORD_HASH");
  console.log("");
  console.log("  Generated owner password (shown ONCE — store it in your password manager):");
  console.log(`      ${password}`);
  console.log("  To change it later: node scripts/hash-password.mjs 'new-password'");
  console.log("  and update ADMIN_PASSWORD_HASH in .env (this invalidates all sessions).");
  console.log("");
} else {
  console.log("ADMIN_PASSWORD_HASH already set — left unchanged.");
}

// Friendly defaults, but only when completely absent.
if (getEnvValue(content, "APP_ORIGIN") === null || getEnvValue(content, "APP_ORIGIN") === "") {
  content = setEnvValue(content, "APP_ORIGIN", "http://localhost:3000");
  changed.push("APP_ORIGIN");
}

if (changed.length > 0) {
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  console.log(`Updated ${changed.length} value(s) in .env: ${changed.join(", ")}.`);
}

console.log("");
console.log("Next steps:");
console.log("  1. Make sure a PostgreSQL database exists and DATABASE_URL points to it.");
console.log("     Local Docker database:  docker compose up -d db");
console.log("     Local native database:  createdb pct_crm  (after creating a user)");
console.log("  2. Apply migrations:       npm run migrate");
console.log("  3. Start the app:          npm run dev   (or npm run build && npm start)");
console.log("");
console.log("See README.md for hosted-PostgreSQL (TLS) and Docker instructions.");
