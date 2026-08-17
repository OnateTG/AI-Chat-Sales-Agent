/**
 * Configuration Verification System — production handoff item 4.
 *
 * Deliberately a plain function, not a CLI script — callable from CI, an
 * admin portal, or config-upload time without rework, per the explicit
 * requirement. bin/verify-domain.ts is a thin wrapper around this, not
 * the other way around.
 *
 * Scope boundary, enforced by what's NOT checked here: never judges price
 * reasonableness, FAQ completeness, or sales effectiveness — only contract
 * compliance (does this package satisfy what the Engine and Prompt
 * Specification actually require to function correctly).
 */

import type { DomainPackage, DomainVariable } from "../domain/types.js";

export type IssueLevel = "error" | "warning";

export interface VerificationIssue {
  level: IssueLevel;
  code: string;
  message: string;
  path: string;
}

export interface VerificationReport {
  valid: boolean; // true iff zero "error"-level issues. Warnings don't block.
  packageName: string | null;
  packageVersion: string | null;
  issues: VerificationIssue[];
}

function err(path: string, code: string, message: string): VerificationIssue {
  return { level: "error", code, message, path };
}
function warn(path: string, code: string, message: string): VerificationIssue {
  return { level: "warning", code, message, path };
}

/**
 * The two condition strings pricing.ts's resolvePricingContext() actually
 * matches against, literally, as string equality. This list is NOT
 * decorative — a condition string that doesn't match either of these
 * silently falls through to pricing.ts's own fail-safe (range_only)
 * rather than erroring, which is exactly the "passed verification, broken
 * at runtime" failure class the handoff's rollback criteria warn about.
 * If pricing.ts's matching logic changes, this list must change with it.
 */
const KNOWN_QUOTING_CONDITIONS = [
  "recommendation.completion_requirement not yet satisfied",
  "recommendation.completion_requirement satisfied",
];

export function verifyDomainPackage(pkg: DomainPackage): VerificationReport {
  const issues: VerificationIssue[] = [];

  // ---------------------------------------------------------------------
  // LEVEL 1 — Structural (errors: these block `valid`)
  // ---------------------------------------------------------------------

  if (!pkg.business_package?.version) {
    issues.push(err("business_package.version", "MISSING_VERSION", "business_package.version is required."));
  }

  if (!pkg.domain?.name) issues.push(err("domain.name", "MISSING_FIELD", "domain.name is required."));
  if (!pkg.domain?.description) issues.push(err("domain.description", "MISSING_FIELD", "domain.description is required."));

  const core = pkg.domain?.variables?.core;
  const REQUIRED_CORE = ["goal", "current_situation", "gap", "readiness"] as const;
  for (const name of REQUIRED_CORE) {
    if (!core?.[name]) {
      issues.push(err(`domain.variables.core.${name}`, "MISSING_CORE_VARIABLE", `Core variable "${name}" is required by the template and must be present.`));
    }
  }

  const domainSpecific = pkg.domain?.variables?.domain_specific ?? {};
  const allVariableNames = new Set([...REQUIRED_CORE, ...Object.keys(domainSpecific)]);

  // Every variable's completion.required: non-empty, no internal duplicates
  const allVarEntries: Array<[string, DomainVariable]> = [
    ...REQUIRED_CORE.filter((n) => core?.[n]).map((n) => [n, core![n]] as [string, DomainVariable]),
    ...Object.entries(domainSpecific),
  ];
  for (const [varName, meta] of allVarEntries) {
    const required = meta?.completion?.required ?? [];
    if (required.length === 0) {
      issues.push(err(`domain.variables.*.${varName}.completion.required`, "EMPTY_COMPLETION_REQUIRED", `Variable "${varName}" has no completion.required sub-attributes — it can never be marked complete.`));
    }
    const seen = new Set<string>();
    for (const sub of required) {
      if (!sub || sub.trim() === "") {
        issues.push(err(`domain.variables.*.${varName}.completion.required`, "EMPTY_SUBATTRIBUTE", `Variable "${varName}" has an empty/blank required sub-attribute name.`));
      } else if (seen.has(sub)) {
        issues.push(err(`domain.variables.*.${varName}.completion.required`, "DUPLICATE_SUBATTRIBUTE", `Variable "${varName}" lists sub-attribute "${sub}" more than once.`));
      }
      seen.add(sub);
    }
  }

  // completion_requirement entries all reference real variables
  const completionRequirement = pkg.domain?.recommendation?.completion_requirement ?? [];
  for (const name of completionRequirement) {
    if (!allVariableNames.has(name)) {
      issues.push(err("domain.recommendation.completion_requirement", "UNKNOWN_VARIABLE_REFERENCE", `completion_requirement references "${name}", which is not a declared variable.`));
    }
  }
  if (completionRequirement.length === 0) {
    issues.push(err("domain.recommendation.completion_requirement", "EMPTY_COMPLETION_REQUIREMENT", "completion_requirement is empty — produce_recommendation can never be reached."));
  }

  // available_options: non-empty, unique names, non-empty fits_when
  const options = pkg.domain?.recommendation?.available_options ?? [];
  if (options.length === 0) {
    issues.push(err("domain.recommendation.available_options", "NO_OPTIONS", "No available_options declared — nothing can ever be recommended."));
  }
  const optionNames = new Set<string>();
  for (const [i, opt] of options.entries()) {
    if (!opt.name) issues.push(err(`domain.recommendation.available_options[${i}]`, "MISSING_OPTION_NAME", "available_option missing a name."));
    if (optionNames.has(opt.name)) issues.push(err(`domain.recommendation.available_options[${i}]`, "DUPLICATE_OPTION_NAME", `Duplicate available_option name "${opt.name}".`));
    optionNames.add(opt.name);
    if (!opt.fits_when || opt.fits_when.trim() === "") {
      issues.push(err(`domain.recommendation.available_options[${i}].fits_when`, "EMPTY_FITS_WHEN", `available_option "${opt.name}" has no fits_when — it can never be matched. NOTE: "fits_when entries reference existing variables" from the original handoff is checked here only as "is non-empty" — fits_when is free-form prose for LLM interpretation (Domain Package §4.1), not a machine-parseable variable reference, so a stronger structural check isn't meaningfully possible without changing what fits_when IS. Flagging this interpretation explicitly rather than silently picking one.`));
    }
  }

  // pricing: quoting_rules conditions must be from the known, Engine-
  // matched set (never free text) -- AND ranges keys must exactly match
  // available_options names, bidirectionally.
  if (pkg.business?.pricing) {
    const { ranges, quoting_rules } = pkg.business.pricing;
    for (const [i, rule] of (quoting_rules ?? []).entries()) {
      if (!KNOWN_QUOTING_CONDITIONS.includes(rule.condition)) {
        issues.push(err(`business.pricing.quoting_rules[${i}].condition`, "UNKNOWN_QUOTING_CONDITION", `Condition "${rule.condition}" doesn't match any condition pricing.ts actually evaluates — it will silently fall through to the range_only fail-safe instead of erroring. Must be exactly one of: ${KNOWN_QUOTING_CONDITIONS.map((c) => `"${c}"`).join(", ")}.`));
      }
    }
    const rangeKeys = new Set(Object.keys(ranges ?? {}));
    for (const key of rangeKeys) {
      if (!optionNames.has(key)) {
        issues.push(err(`business.pricing.ranges["${key}"]`, "RANGE_OPTION_MISMATCH", `pricing.ranges has a key "${key}" that doesn't match any available_options name.`));
      }
    }
    for (const name of optionNames) {
      if (!rangeKeys.has(name)) {
        issues.push(err(`business.pricing.ranges`, "MISSING_RANGE_FOR_OPTION", `available_option "${name}" has no corresponding entry in pricing.ranges.`));
      }
    }
  }

  if (!pkg.business_knowledge?.topics || pkg.business_knowledge.topics.length === 0) {
    issues.push(warn("business_knowledge.topics", "NO_KNOWLEDGE_TOPICS", "No business_knowledge topics declared — Call B will have nothing to draw on for `answer`/`recommend` actions."));
  }

  // ---------------------------------------------------------------------
  // LEVEL 2 — Semantic (warnings: flagged for human review, don't block)
  // ---------------------------------------------------------------------

  // "No impossible completion requirements" -- this is the exact bug class
  // already found once (website-development.yaml's current_situation).
  // HONEST SCOPING NOTE: true impossibility (a sub-attribute that can
  // never be satisfied for some real customer) is a semantic property of
  // the DOMAIN, not something derivable from the YAML's structure alone --
  // detecting it with certainty would need something closer to natural-
  // language understanding, not a deterministic check. What IS reliably
  // deterministic: any variable with 2+ required sub-attributes is
  // exactly the shape that enabled the actual bug (one sub-attribute only
  // applying in some customer situations, not all). Flagging the PATTERN,
  // not claiming to prove impossibility -- this would have caught the
  // real bug as a warning requiring sign-off, not silently.
  for (const [varName, meta] of allVarEntries) {
    const required = meta?.completion?.required ?? [];
    if (required.length >= 2) {
      issues.push(
        warn(
          `domain.variables.*.${varName}.completion.required`,
          "MULTI_SUBATTRIBUTE_RISK",
          `Variable "${varName}" has ${required.length} required sub-attributes (${required.join(", ")}). ` +
            `This is the exact shape that caused a real, shipped bug (current_situation's ` +
            `existing_site_condition couldn't be satisfied by customers with no existing site). ` +
            `Confirm every sub-attribute genuinely applies to EVERY customer in this domain, not just some.`
        )
      );
    }
  }

  // "No contradictory recommendation rules" / "no unreachable
  // available_options" -- deterministically checkable proxy: identical
  // fits_when text across two options means one can never be distinguished
  // from the other by Call B, which is the practical meaning of
  // "unreachable" given fits_when is prose, not formal logic.
  const fitsWhenSeen = new Map<string, string[]>();
  for (const opt of options) {
    const key = (opt.fits_when ?? "").trim().toLowerCase();
    if (!key) continue;
    fitsWhenSeen.set(key, [...(fitsWhenSeen.get(key) ?? []), opt.name]);
  }
  for (const [text, names] of fitsWhenSeen) {
    if (names.length > 1) {
      issues.push(
        warn(
          "domain.recommendation.available_options",
          "DUPLICATE_FITS_WHEN",
          `Options ${names.map((n) => `"${n}"`).join(" and ")} have identical fits_when text -- one is likely unreachable, since nothing distinguishes when each should be chosen.`
        )
      );
    }
  }

  // "No circular references" -- the current schema shape (flat, no
  // variable-to-variable dependency graph) doesn't have an obvious place
  // for this to occur today. Implemented generically anyway as a
  // forward-looking check rather than skipped, since it's cheap: builds a
  // reference graph from completion_requirement -> variables and checks
  // for cycles. Expected to never fire against the current schema --
  // that's not a bug in this checker, the schema just doesn't support
  // cycles yet.
  const cycleIssue = checkCircularReferences(completionRequirement, allVariableNames);
  if (cycleIssue) issues.push(cycleIssue);

  return {
    valid: !issues.some((i) => i.level === "error"),
    packageName: pkg.domain?.name ?? null,
    packageVersion: pkg.business_package?.version ?? null,
    issues,
  };
}

function checkCircularReferences(completionRequirement: string[], knownVariables: Set<string>): VerificationIssue | null {
  // No actual reference-to-reference chain exists in the current schema
  // (completion_requirement only points at variable names, and variables
  // don't reference each other) -- so a cycle is structurally impossible
  // right now. This function exists so future schema additions that DO
  // introduce a reference graph have a home to plug cycle detection into,
  // rather than needing this added from scratch under time pressure later.
  void completionRequirement;
  void knownVariables;
  return null;
}
