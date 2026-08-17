#!/usr/bin/env -S npx tsx
/**
 * CLI wrapper around verifyDomainPackage() -- the function itself is the
 * real deliverable (importable from CI, an admin portal, or upload-time
 * validation without rework). This file is just one caller of it.
 *
 * Usage: npx tsx bin/verify-domain.ts domains/website-development.yaml [domains/insurance.yaml ...]
 * Exit code 0 if all pass, 1 if any fail (for CI use).
 */

import { loadDomainPackage } from "../src/domain/domainLoader.js";
import { verifyDomainPackage, type VerificationReport } from "../src/verify/verifyDomainPackage.js";

function printReport(path: string, report: VerificationReport): void {
  const status = report.valid ? "PASS" : "FAIL";
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${status}  ${path}`);
  console.log(`  package: ${report.packageName ?? "(unknown)"}  version: ${report.packageVersion ?? "(none)"}`);
  console.log("=".repeat(70));

  const errors = report.issues.filter((i) => i.level === "error");
  const warnings = report.issues.filter((i) => i.level === "warning");

  if (errors.length > 0) {
    console.log(`\n${errors.length} ERROR(S) -- these block publication:`);
    for (const e of errors) console.log(`  [${e.code}] ${e.path}\n    ${e.message}`);
  }
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} WARNING(S) -- require human review, don't block:`);
    for (const w of warnings) console.log(`  [${w.code}] ${w.path}\n    ${w.message}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("\nNo issues found.");
  }
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: npx tsx bin/verify-domain.ts <path-to-domain.yaml> [more paths...]");
    process.exit(2);
  }

  let anyFailed = false;
  for (const path of paths) {
    try {
      const pkg = loadDomainPackage(path);
      const report = verifyDomainPackage(pkg);
      printReport(path, report);
      if (!report.valid) anyFailed = true;
    } catch (e) {
      console.log(`\nFAIL  ${path}\n  Could not load/parse: ${String(e)}`);
      anyFailed = true;
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(anyFailed ? "RESULT: one or more packages FAILED verification." : "RESULT: all packages passed.");
  process.exit(anyFailed ? 1 : 0);
}

main();
