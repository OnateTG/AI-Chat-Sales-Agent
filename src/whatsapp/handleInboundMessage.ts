/**
 * The actual per-message handling logic, extracted from server.ts so it's
 * directly testable — a test can call this with a fake store/sender and
 * verify the kill switch, the B1 handoff path, and misbehavior logging all
 * actually engage, without spinning up a real HTTP server. server.ts is a
 * thin wrapper around this: parse the request, call this, done.
 */

import pino from "pino";
import { runTurn } from "../engine/pipeline.js";
import type { ConversationStore } from "../store/store.js";
import type { WebhookIdempotencyStore } from "../store/webhookIdempotencyStore.js";
import type { DomainPackage } from "../domain/types.js";
import type { ChatCompletionFn } from "../llm/router.js";
import type { InboundWhatsAppMessage } from "./webhook.js";

const logger = pino({ name: "inbound-handler" });

export interface HandleInboundMessageDeps {
  store: ConversationStore;
  idempotencyStore: WebhookIdempotencyStore; // P0 finding (HANDOVER §6 item 3) -- required, not optional, so every real
                                              // and test call site makes an explicit choice rather than silently
                                              // skipping dedup tracking
  domain: DomainPackage;
  toneConfig: string;
  sendMessage: (to: string, text: string) => Promise<void>;
  chatCompletionFn?: ChatCompletionFn; // testing seam, same as pipeline.ts's
  repeatCountThreshold?: number; // defaults to 3, parameterized so tests don't hardcode it twice
}

export async function handleInboundMessage(inbound: InboundWhatsAppMessage, deps: HandleInboundMessageDeps): Promise<void> {
  const { store, idempotencyStore, domain, toneConfig, sendMessage, chatCompletionFn, repeatCountThreshold = 3 } = deps;

  try {
    // Idempotency — checked BEFORE anything else, deliberately: Meta
    // retries a webhook delivery that didn't get a fast, successful-
    // looking response, so the same message.id can arrive more than once.
    // Checked ahead of even the kill switch so a retried delivery for an
    // already-paused conversation doesn't do a redundant store read/log
    // either. See src/store/webhookIdempotencyStore.ts.
    if (idempotencyStore.checkAndRecord(inbound.id)) {
      logger.info(
        { from: inbound.from, messageId: inbound.id },
        "signal=DUPLICATE_DELIVERY -- message.id already processed, skipping (Meta webhook retry)"
      );
      return;
    }

    const record = store.getOrCreate(inbound.from, domain.business_package.version);

    // Kill switch — checked BEFORE any pipeline work, deliberately: an
    // operator-paused conversation shouldn't burn a Call A/Call B
    // invocation just to be told not to reply. See bin/kill-switch.ts.
    if (record.automation_paused) {
      logger.warn(
        { from: inbound.from, reason: record.paused_reason, pausedBy: record.paused_by, pausedAt: record.paused_at },
        "signal=AUTOMATION_PAUSED -- inbound message received but not processed, awaiting human"
      );
      return;
    }

    const { record: updated, reply, requiresHumanHandoff } = await runTurn({
      record,
      event: { type: "inbound_message", text: inbound.text, timestamp: inbound.timestamp },
      domain,
      toneConfig,
      chatCompletionFn,
    });

    store.save(updated);

    // Delta C (ADL-021) note, not a behavior change: this check already
    // correctly isolates ONLY the "error" outcome — pipeline.ts sets
    // requiresHumanHandoff/reply:null exclusively for that case now.
    // "no_objective" (legitimate terminal states) falls through below with
    // a real `reply` string, same as "objective" always did. Verified
    // directly against pipeline.ts's two return points, not assumed —
    // this file needed zero logic changes for the tri-state split;
    // renaming the signal below since "NO_VALID_OBJECTIVE" is now stale
    // terminology for what's specifically the "error" outcome.
    if (requiresHumanHandoff || reply === null) {
      logger.error(
        { from: inbound.from, signal: "OBJECTIVE_ERROR" },
        "signal=OBJECTIVE_ERROR -- ObjectiveOutcome was 'error' (Problem B territory), no automated reply sent, no handoff system connected yet"
      );
      return;
    }

    if (updated.repeat_count >= repeatCountThreshold) {
      logger.warn(
        { from: inbound.from, signal: "REPEATED_OBJECTIVE", objective: updated.last_objective, target: updated.last_target, count: updated.repeat_count },
        `signal=REPEATED_OBJECTIVE -- same (objective, target) fired ${updated.repeat_count} times in a row, conversation may be stuck`
      );
      // Deliberately NOT auto-pausing here. Detection and structured
      // logging only -- auto-triggering the kill switch on this signal
      // would be a real behavioral decision that wasn't asked for, not a
      // logging enhancement. A human decides what to do with this signal.
    }

    await sendMessage(inbound.from, reply);
  } catch (err) {
    logger.error({ err: String(err), from: inbound.from }, "turn processing failed");
    // Deliberately does not attempt a generic fallback reply — a silent
    // failure here should surface in logs and get investigated, not be
    // papered over with a canned "something went wrong" message that could
    // mask a real defect. Revisit once there's real production traffic to
    // learn from.
  }
}
