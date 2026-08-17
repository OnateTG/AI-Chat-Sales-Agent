#!/usr/bin/env -S npx tsx
/**
 * Generates OPERATOR_PASSWORD_HASH for .env — run this once, paste the
 * output into .env, never store the plaintext password anywhere.
 * Usage: npx tsx bin/hash-password.ts "your-password-here"
 */

import { hashPassword } from "../src/services/authUtil.js";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npx tsx bin/hash-password.ts "your-password-here"');
  process.exit(2);
}

console.log("\nAdd this line to your .env file:\n");
console.log(`OPERATOR_PASSWORD_HASH=${hashPassword(password)}`);
console.log("\nDo not commit .env or store the plaintext password anywhere else.\n");
