/**
 * Configuration Service — operator dashboard scope.
 *
 * Governing rule: the dashboard never touches YAML directly. Every
 * business-config operation goes through here.
 *
 * Save pipeline, as actually built:
 *   load -> modify -> verify -> version increment -> backup -> write to
 *   temp -> fsync -> atomic rename -> hot reload -> return result
 *
 * Two deliberate deviations from a literal load->modify->verify->backup->
 * write reading, worth stating clearly:
 * - verify runs BEFORE backup, not after — backing up before knowing the
 *   edit is even valid would mean "backup wasn't consumed for nothing"
 *   (an explicit verification requirement) fails on every rejected edit.
 * - version increment happens BEFORE backup, not after and not at the
 *   end — the bumped version has to be embedded in the document content
 *   itself before that content is written, so it can't be applied after
 *   the file is already on disk. It's set on the in-memory candidate
 *   (`doc.setIn(...)`), which is what both the backup-comparison and the
 *   eventual written file are derived from.
 *
 * Uses `yaml` (not `js-yaml`) for the write path specifically — verified
 * directly (not assumed) that a naive js-yaml parse-modify-dump cycle
 * silently drops every comment in these files (21 -> 0, checked before
 * writing any of this). `yaml`'s Document API with setIn() edits
 * surgically and preserves everything else, including the ADL cross-
 * references and placeholder markers these files depend on for context.
 */

import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, statSync } from "node:fs";
import yamlLib from "js-yaml";
import { parseDocument } from "yaml";
import { verifyDomainPackage, type VerificationIssue } from "../verify/verifyDomainPackage.js";
import { loadDomainPackage } from "../domain/domainLoader.js";
import { backupFile } from "./backupUtil.js";
import type { DomainPackage, AvailableOption, BusinessKnowledgeTopic } from "../domain/types.js";

// Only business.pricing.RANGES is editable, not quoting_rules — this is a
// deliberate narrowing from the original "business.pricing" scope, not an
// oversight. Grounded in precedent already established in this project's
// own ADL (the fact/rule ownership split): ranges are FACT (Call B-facing,
// safe for an operator to change), quoting_rules are RULE (Engine-
// evaluated, must match one of 2 fixed condition strings verified
// elsewhere — an operator typo here wouldn't error, it would silently
// misbehave, per ADL-013's own UNKNOWN_QUOTING_CONDITION finding). Same
// reasoning as why completion_requirement/variables/fits_when-as-a-
// mechanism are kernel-structural and excluded.
export interface EditableChanges {
  pricing_ranges?: Record<string, string>;
  business_knowledge_topics?: BusinessKnowledgeTopic[];
  available_options?: AvailableOption[];
}

export interface DiffEntry {
  path: string;
  oldValue: string;
  newValue: string;
}

export interface SaveResult {
  success: boolean;
  version?: string;
  diff?: DiffEntry[];
  errors?: VerificationIssue[];
  backupPath?: string;
  reloadFailed?: boolean;
  reloadError?: string;
}

/** Mutable holder so server.ts and ConfigurationService share the SAME
 * live reference — hot reload is just swapping `.current` here. Passed in
 * by server.ts, not owned by this service, since server.ts is what
 * actually hands `domain` to every incoming request. */
export interface DomainRef {
  current: DomainPackage;
}

function bumpPatchVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    throw new Error(`Cannot bump version "${version}" -- doesn't match a recognizable x.y.z pattern.`);
  }
  const [, major, minor, patch, suffix] = match;
  return `${major}.${minor}.${Number(patch) + 1}${suffix}`;
}

export class ConfigurationService {
  private domainPath: string;
  private domainRef: DomainRef;
  private locked = false;
  private reloadFn: (path: string) => DomainPackage;

  constructor(domainPath: string, domainRef: DomainRef, reloadFn: (path: string) => DomainPackage = loadDomainPackage) {
    this.domainPath = domainPath;
    this.domainRef = domainRef;
    // Injectable, same DI pattern as ChatCompletionFn elsewhere in this
    // project -- lets the reload-failure test inject a genuine failure
    // directly, rather than trying to corrupt the filesystem mid-test to
    // simulate one. Defaults to the real loadDomainPackage in production.
    this.reloadFn = reloadFn;
  }

  // Addendum A — explicit read method, not a generic raw-object getter.
  getConfiguration(): DomainPackage {
    return this.domainRef.current;
  }

  /** Read-only display requirements: version, last modified, verification
   * status. statSync lives HERE, inside the service, specifically so the
   * dashboard routes layer never needs its own file access to show this —
   * the governing rule is "dashboard never does file I/O," full stop. */
  getMetadata(): { version: string; lastModified: string; verificationStatus: "valid" | "invalid"; issues: VerificationIssue[] } {
    const stat = statSync(this.domainPath);
    const verification = verifyDomainPackage(this.domainRef.current);
    return {
      version: this.domainRef.current.business_package.version,
      lastModified: stat.mtime.toISOString(),
      verificationStatus: verification.valid ? "valid" : "invalid",
      issues: verification.issues,
    };
  }

  previewChanges(changes: EditableChanges): { diff: DiffEntry[]; errors?: VerificationIssue[] } {
    const before = this.domainRef.current;
    const after = this.applyChanges(before, changes);
    const renameIssues = findOptionRenames(before.domain.recommendation.available_options, changes);
    return {
      diff: computeDiff(before, after, changes),
      ...(renameIssues.length > 0 ? { errors: renameIssues } : {}),
    };
  }

  async saveChanges(changes: EditableChanges): Promise<SaveResult> {
    // Lock check-and-set is synchronous, before any await -- Node's
    // single-threaded event loop makes this safe against the concurrent-
    // save race the verification requirements explicitly ask about.
    if (this.locked) {
      return { success: false, errors: [{ level: "error", code: "SAVE_IN_PROGRESS", message: "Another save is already in progress. Try again shortly.", path: "" }] };
    }
    this.locked = true;

    try {
      const originalText = readFileSync(this.domainPath, "utf-8");
      const before = yamlLib.load(originalText) as DomainPackage;
      const doc = parseDocument(originalText);

      // Checked before even building the candidate/running the general
      // verifier -- disallowing renames in v1 (item 12, see docs/ADL.md)
      // is a distinct, named rejection, not left to surface as the
      // verifier's generic downstream RANGE_OPTION_MISMATCH once the old
      // name's pricing.ranges key is already orphaned. Same "verify
      // BEFORE backup" reasoning as the step below: reject before doing
      // any file work, not after.
      const renameIssues = findOptionRenames(before.domain.recommendation.available_options, changes);
      if (renameIssues.length > 0) {
        return { success: false, errors: renameIssues };
      }

      this.applyChangesToDocument(doc, changes);
      const candidate = doc.toJS() as DomainPackage;

      const verification = verifyDomainPackage(candidate);
      if (!verification.valid) {
        // Verify BEFORE backup -- an invalid edit consumes no backup.
        return { success: false, errors: verification.issues.filter((i) => i.level === "error") };
      }

      const newVersion = bumpPatchVersion(before.business_package.version);
      doc.setIn(["business_package", "version"], newVersion);
      const finalCandidate = doc.toJS() as DomainPackage; // re-read after version bump, for the diff and reload comparison

      const backupPath = backupFile(this.domainPath);

      // Atomic write: temp file -> fsync -> rename. No write ever leaves
      // a half-written YAML on disk, even on a crash mid-write.
      const tmpPath = `${this.domainPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const fd = openSync(tmpPath, "w");
      writeFileSync(fd, doc.toString());
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmpPath, this.domainPath);

      // Hot reload. Option (a) from the addendum: retain the previous
      // in-memory configuration until reload succeeds, report failure
      // clearly, don't swap on failure. This is close to the NATURAL
      // behavior of "don't swap until the new load succeeds" rather than
      // something requiring separate restore logic — the file write
      // already succeeded and was fsynced before this point, so a reload
      // failure here is a different failure mode (e.g. a transient read
      // issue) than file corruption, which the atomic write already
      // prevents.
      try {
        const reloaded = this.reloadFn(this.domainPath);
        this.domainRef.current = reloaded;
      } catch (reloadErr) {
        return {
          success: true,
          version: newVersion,
          backupPath,
          reloadFailed: true,
          reloadError: String(reloadErr),
        };
      }

      return {
        success: true,
        version: newVersion,
        backupPath,
        diff: computeDiff(before, finalCandidate, changes),
      };
    } finally {
      this.locked = false;
    }
  }

  private applyChanges(current: DomainPackage, changes: EditableChanges): DomainPackage {
    // Used by previewChanges() only -- a plain deep-clone-and-patch,
    // since preview never touches the file and doesn't need the
    // comment-preserving Document machinery. Explicit field assignments,
    // not a generic recursive merge -- there's no path by which a change
    // outside the three named fields could be smuggled in, by
    // construction, not just by the type system.
    const clone: DomainPackage = JSON.parse(JSON.stringify(current));
    if (changes.pricing_ranges && clone.business?.pricing) {
      clone.business.pricing.ranges = { ...clone.business.pricing.ranges, ...changes.pricing_ranges };
    }
    if (changes.business_knowledge_topics) {
      clone.business_knowledge.topics = changes.business_knowledge_topics;
    }
    if (changes.available_options) {
      clone.domain.recommendation.available_options = changes.available_options;
    }
    return clone;
  }

  private applyChangesToDocument(doc: ReturnType<typeof parseDocument>, changes: EditableChanges): void {
    if (changes.pricing_ranges) {
      for (const [option, range] of Object.entries(changes.pricing_ranges)) {
        doc.setIn(["business", "pricing", "ranges", option], range);
      }
    }
    if (changes.business_knowledge_topics) {
      doc.setIn(["business_knowledge", "topics"], changes.business_knowledge_topics);
    }
    if (changes.available_options) {
      doc.setIn(["domain", "recommendation", "available_options"], changes.available_options);
    }
  }
}

/**
 * Detects a renamed `available_option` (same index, different `name`) —
 * disallowed in v1 rather than building cascading-rename logic to keep
 * `business.pricing.ranges` keys in sync with an option's name (item 12,
 * see docs/ADL.md / HANDOVER "Should-fix" item 12 — the handover's own
 * recommendation, implemented as given, not a new decision). Compared by
 * index, same reasoning `diffArrayByIndex` above gives: the dashboard
 * edits these by position (`data-idx`), so index is what "the same
 * option, edited" actually means here — there's no separate stable id to
 * key on.
 *
 * Reported as its own named, actionable error rather than left to
 * surface later as the verifier's generic RANGE_OPTION_MISMATCH once the
 * old name's `pricing.ranges` key is already orphaned by the rename —
 * that downstream symptom doesn't make "undo the rename" obvious as the
 * fix. Called from both previewChanges (so an operator finds out before
 * clicking save, restoring the actual point of having a preview — see
 * item 10's identical framing) and saveChanges (defense in depth; the
 * preview step is advisory, this one is the actual, only-place-that-
 * matters enforcement).
 */
function findOptionRenames(before: AvailableOption[], changes: EditableChanges): VerificationIssue[] {
  if (!changes.available_options) return [];

  const issues: VerificationIssue[] = [];
  const maxLen = Math.max(before.length, changes.available_options.length);

  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = changes.available_options[i];
    if (b && a && b.name !== a.name) {
      issues.push({
        level: "error",
        code: "OPTION_RENAME_NOT_ALLOWED",
        message: `Renaming an available option is not supported in v1 (index ${i}: "${b.name}" -> "${a.name}"). This would leave business.pricing.ranges["${b.name}"] orphaned rather than moved to a new key automatically. To change what this option is called, remove "${b.name}" and add a new option with the new name and its own price range instead.`,
        path: `domain.recommendation.available_options[${i}].name`,
      });
    }
  }

  return issues;
}

function computeDiff(before: DomainPackage, after: DomainPackage, changes: EditableChanges): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (changes.pricing_ranges) {
    for (const option of Object.keys(changes.pricing_ranges)) {
      const oldValue = before.business?.pricing?.ranges?.[option] ?? "(not set)";
      const newValue = after.business?.pricing?.ranges?.[option] ?? "(not set)";
      if (oldValue !== newValue) {
        entries.push({ path: `business.pricing.ranges["${option}"]`, oldValue, newValue });
      }
    }
  }
  if (changes.business_knowledge_topics) {
    entries.push(
      ...diffArrayByIndex(before.business_knowledge.topics, after.business_knowledge.topics, "business_knowledge.topics", (t) => [
        { field: "topic", value: t.topic },
        { field: "content", value: t.content },
      ])
    );
  }
  if (changes.available_options) {
    entries.push(
      ...diffArrayByIndex(
        before.domain.recommendation.available_options,
        after.domain.recommendation.available_options,
        "domain.recommendation.available_options",
        (o) => [
          { field: "name", value: o.name },
          { field: "fits_when", value: o.fits_when },
        ]
      )
    );
  }

  return entries;
}

/**
 * Field-level diff for an ordered list of edited records (business
 * knowledge topics, available options), one DiffEntry per field that
 * actually changed -- generalizes the same per-key granularity
 * pricing_ranges already had (P0 item 10, see docs/ADL.md /
 * HANDOVER §"Should-fix" item 10). The dashboard edits these by index
 * (`data-idx` in index.html), not by a stable id, so index-based
 * comparison is the correct match for what actually changed on screen --
 * not a name/content-based diff that would misreport a same-index edit as
 * an unrelated add+remove pair.
 *
 * Before this fix, the caller unconditionally pushed one summary entry
 * per section whenever that section was present in `changes` at all --
 * and `collectChanges()` in index.html always populates all three
 * sections on every save, whether the operator touched them or not. That
 * made the bug worse than "unhelpful when something changed": it showed
 * a false "changed" entry (e.g. "3 topic(s) -> 3 topic(s)") on saves
 * where that section was untouched. Comparing field-by-field and only
 * emitting an entry on an actual difference fixes both: a real edit now
 * shows exactly which field of which item changed, and an untouched
 * section now correctly produces zero entries.
 */
function diffArrayByIndex<T>(
  before: T[],
  after: T[],
  basePath: string,
  describe: (item: T) => Array<{ field: string; value: string }>
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];

    if (b === undefined) {
      for (const { field, value } of describe(a)) {
        entries.push({ path: `${basePath}[${i}].${field}`, oldValue: "(not present)", newValue: value });
      }
      continue;
    }
    if (a === undefined) {
      for (const { field, value } of describe(b)) {
        entries.push({ path: `${basePath}[${i}].${field}`, oldValue: value, newValue: "(removed)" });
      }
      continue;
    }

    const beforeFields = describe(b);
    const afterFields = describe(a);
    for (let f = 0; f < beforeFields.length; f++) {
      if (beforeFields[f].value !== afterFields[f].value) {
        entries.push({ path: `${basePath}[${i}].${beforeFields[f].field}`, oldValue: beforeFields[f].value, newValue: afterFields[f].value });
      }
    }
  }

  return entries;
}
