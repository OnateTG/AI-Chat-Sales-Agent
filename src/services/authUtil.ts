/**
 * Password hashing for the operator dashboard (addendum C): a standard,
 * purpose-built, slow credential hash — explicitly not SHA-256 or any
 * general-purpose hash, since fast hashing is exactly the wrong property
 * for credential storage.
 *
 * Uses Node's built-in `crypto.scrypt` rather than an npm bcrypt/argon2
 * package deliberately: scrypt is explicitly listed as acceptable in the
 * addendum, and it's part of Node core — zero dependency risk. This
 * project already hit a real native-binary compile failure once
 * (better-sqlite3, see docs/ADL.md) in this sandboxed environment; a
 * pure-core solution avoids repeating that specific class of problem.
 */

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** Returns "salt:hash", both hex-encoded — this whole string is what gets stored in OPERATOR_PASSWORD_HASH. */
export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plaintext, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plaintext: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plaintext, salt, KEY_LENGTH);
  if (actual.length !== expected.length) return false;
  // Timing-safe comparison -- a plain === on the derived hash would leak
  // timing information about how many leading bytes matched.
  return timingSafeEqual(actual, expected);
}
