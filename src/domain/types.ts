/**
 * Domain Package Specification §1 — Domain Definition template, typed.
 * A domain package is pure config: writing one must never require touching
 * src/engine/. If it does, something upstream was designed wrong (per the
 * spec's own purpose statement).
 *
 * Restructured to the domain/business/business_knowledge three-section
 * split (organized by consumer, per the spec's current §1 — Engine reads
 * `domain`, Engine+Call B read `business`, Call B only reads
 * `business_knowledge`). Previously `pricing` sat at the top level and
 * knowledge content was called `domain_knowledge` — both renamed here to
 * match. See docs/ADL.md for the sync entry.
 */

import type { QuotingRule } from "../engine/pricing.js";

export interface DomainVariable {
  description: string;
  importance: "critical" | "high" | "medium" | "low";
  completion: { required: string[] };
}

export interface AvailableOption {
  name: string;
  fits_when: string;
}

export interface BusinessKnowledgeTopic {
  topic: string;
  content: string;
}

export interface DomainPackage {
  // Required per production handoff's Business Package Versioning
  // requirement — every business package must carry an explicit version.
  business_package: { version: string };
  domain: {
    name: string;
    description: string;
    variables: {
      core: {
        goal: DomainVariable;
        current_situation: DomainVariable;
        gap: DomainVariable;
        readiness: DomainVariable;
      };
      domain_specific: Record<string, DomainVariable>;
    };
    recommendation: {
      available_options: AvailableOption[];
      completion_requirement: string[];
      no_fit_fallback: string;
    };
  };
  // §1: Engine-evaluated where applicable (pricing.quoting_rules), otherwise
  // supplied to Call B alongside business_knowledge. Optional — a domain
  // need not declare pricing.
  business?: {
    pricing?: {
      ranges: Record<string, string>;
      quoting_rules: QuotingRule[];
    };
  };
  business_knowledge: { topics: BusinessKnowledgeTopic[] };
}

/** Flattens core + domain_specific into the list objective.ts iterates over. */
export function allVariables(pkg: DomainPackage): Array<{ name: string; meta: DomainVariable }> {
  const core = pkg.domain.variables.core;
  return [
    { name: "goal", meta: core.goal },
    { name: "current_situation", meta: core.current_situation },
    { name: "gap", meta: core.gap },
    { name: "readiness", meta: core.readiness },
    ...Object.entries(pkg.domain.variables.domain_specific).map(([name, meta]) => ({ name, meta })),
  ];
}
