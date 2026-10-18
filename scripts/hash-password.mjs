#!/usr/bin/env node
/**
 * Usage: node scripts/hash-password.mjs 'your-password'
 * Prints a scrypt hash suitable for ADMIN_PASSWORD_HASH in .env.
 */
import crypto from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs 'your-password'");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password, salt, 64, {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
console.log(`scrypt$${salt.toString("base64")}$${key.toString("base64")}`);
console.log("");
console.log("Add to .env as:  ADMIN_PASSWORD_HASH=<the value above>");
console.log("(Changing this value invalidates all existing login sessions.)");
