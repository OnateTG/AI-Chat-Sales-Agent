#!/usr/bin/env -S npx tsx
/**
 * Backup strategy (Operations checklist item), the buildable part.
 *
 * Honest scope: the store is just JSON files under data/conversations/, so
 * "backup" is genuinely simple to reason about -- copy them somewhere else,
 * on a schedule. This script does the "copy them somewhere else" part,
 * locally (a timestamped folder), since that's testable right now without
 * cloud credentials or infrastructure this sandbox can't reach anyway (see
 * the earlier network-reachability finding). Wiring this to actual remote
 * storage (S3, etc.) and a cron schedule is a real deployment-environment
 * decision, documented in docs/DEPLOYMENT.md rather than guessed at here.
 *
 * Uses the same backupFile() ConfigurationService uses for domain package
 * backups -- one implementation of "copy a file into a backup folder," not
 * two. Computes ONE timestamp for the whole batch and passes it explicitly,
 * so all files from one run land together, not scattered per-file.
 *
 * Usage: npx tsx bin/backup.ts [source-dir] [backup-root]
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { backupFile } from "../src/services/backupUtil.js";

function main() {
  const sourceDir = process.argv[2] ?? "data/conversations";
  const backupRoot = process.argv[3] ?? "backups";

  if (!existsSync(sourceDir)) {
    console.error(`Source directory "${sourceDir}" doesn't exist -- nothing to back up.`);
    process.exit(1);
  }

  const files = readdirSync(sourceDir).filter((f) => f.endsWith(".json"));
  const destDir = join(backupRoot, new Date().toISOString().replace(/[:.]/g, "-"));

  for (const file of files) {
    backupFile(join(sourceDir, file), backupRoot, destDir);
  }

  console.log(`Backed up ${files.length} conversation file(s) from "${sourceDir}" to "${destDir}".`);
}

main();
