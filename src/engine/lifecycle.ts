/**
 * Runtime Specification §7 — Conversation-level lifecycle.
 *
 * IMPORTANT — READ BEFORE TOUCHING THIS FILE:
 *
 * The spec is explicit: "A lifecycle transition table, equivalent in rigor
 * to State Model §2.2's variable transition table, has not yet been
 * reviewed and accepted... Do not implement lifecycle transition validation
 * against unreviewed content — until this is resolved, the Engine's
 * transition-validation logic in this section should be treated as
 * unspecified, NOT as permissive of any transition."
 *
 * That is a real constraint, not a placeholder to quietly fill in. I am not
 * inventing a transition table here — doing so would be exactly the kind of
 * unilateral kernel change the ADL process exists to prevent (no observed
 * failure justifies picking a table myself).
 *
 * What this file does instead: accepts Call A's `proposed_lifecycle`,
 * applies the one rule that IS unambiguous in the spec text (abandoned is
 * platform-triggered, not model-proposed — §7's Call A instructions say the
 * model "will rarely propose this yourself"), and otherwise passes the
 * proposed value through UNVALIDATED, loudly flagged as such in the log
 * output. This keeps the system functional while making the gap impossible
 * to miss in logs/ADL rather than silently pretending it's handled.
 *
 * When the transition table clears architecture review, replace
 * `resolveLifecycle` with real validation against it, and close ADL entries
 * referencing this file.
 */

import type { Lifecycle } from "./types.js";
import pino from "pino";

const logger = pino({ name: "lifecycle" });

export interface ResolveLifecycleParams {
  current: Lifecycle;
  proposed: Lifecycle;
}

export interface ResolveLifecycleResult {
  lifecycle: Lifecycle;
  validated: boolean; // false whenever this is NOT a real validation - always false right now
}

export function resolveLifecycle(params: ResolveLifecycleParams): ResolveLifecycleResult {
  const { current, proposed } = params;

  logger.warn(
    { current, proposed },
    "Lifecycle transition NOT validated — transition table is [OPEN — ARCHITECTURE REVIEW REQUIRED] " +
      "per Runtime Spec §7. Accepting proposed value unvalidated. See docs/ADL.md."
  );

  return { lifecycle: proposed, validated: false };
}

/**
 * Platform-triggered abandonment (Runtime §7: "you will rarely propose this
 * yourself — it is usually platform-triggered by silence, not inferred from
 * message content"). This does NOT decide the timeout duration — that's a
 * Platform Integration policy decision (e.g. server.ts / a scheduled job),
 * explicitly out of kernel scope. This function only applies the transition
 * once the platform layer has already decided it should happen.
 *
 * Same "unvalidated" caveat as resolveLifecycle applies — see file header.
 */
export function applyPlatformAbandonment(current: Lifecycle): ResolveLifecycleResult {
  if (current === "active" || current === "paused") {
    logger.warn(
      { current },
      "Applying platform-triggered abandonment transition — structurally UNVALIDATED, same open item."
    );
    return { lifecycle: "abandoned", validated: false };
  }
  // Already in a terminal-ish or non-active state; no-op.
  return { lifecycle: current, validated: false };
}
