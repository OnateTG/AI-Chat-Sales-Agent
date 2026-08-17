/**
 * Shared backup logic — extracted so ConfigurationService can back up a
 * domain package file before overwriting it using the SAME tooling
 * bin/backup.ts uses for conversation data, per the explicit instruction
 * ("uses existing backup tooling") rather than reimplementing file-copy
 * logic a second time.
 */

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";

/** Backs up a single file into destDir/<filename>, computing a fresh
 * timestamped destDir under backupRoot if none is given. Returns the
 * destination path. Accepting an explicit destDir lets a caller (like
 * bin/backup.ts's batch mode) group multiple files under ONE timestamp
 * instead of each call computing its own — passing nothing is the right
 * choice for a single-file backup (ConfigurationService's case). */
export function backupFile(sourcePath: string, backupRoot = "backups", destDir?: string): string {
  if (!existsSync(sourcePath)) {
    throw new Error(`backupFile: source "${sourcePath}" doesn't exist.`);
  }
  const resolvedDestDir = destDir ?? join(backupRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(resolvedDestDir, { recursive: true });
  const destPath = join(resolvedDestDir, basename(sourcePath));
  copyFileSync(sourcePath, destPath);
  return destPath;
}
