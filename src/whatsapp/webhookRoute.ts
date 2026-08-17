/**
 * POST /webhook orchestration, extracted from server.ts so it's directly
 * testable without spinning up a real HTTP server -- same reasoning
 * handleInboundMessage.ts's own header comment gives for that extraction.
 * server.ts becomes a thin wrapper: read the two things only Express can
 * give you (the raw body bytes, the signature header), call these, and
 * translate the result to an HTTP response.
 *
 * Split into two functions, not one, to preserve an existing behavioral
 * property deliberately, not by accident: WhatsApp expects a fast 200 ack
 * and processes the actual reply asynchronously (see the original
 * server.ts comment this replaces). Signature/config validation MUST
 * complete before any response is sent (an unauthenticated request should
 * never get a 200), but the pipeline run that follows a VALID request
 * must NOT be awaited before that 200 goes out, or a slow Call A/B risks
 * Meta's own delivery timeout and a needless retry. A single combined
 * async function would either violate the first property (respond before
 * validating) or the second (block the ack on the pipeline) -- there's no
 * single-function version of this that preserves both.
 */

import pino from "pino";
import { parseInboundMessage, verifyWebhookSignature } from "./webhook.js";
import { handleInboundMessage, type HandleInboundMessageDeps } from "./handleInboundMessage.js";

const logger = pino({ name: "webhook-route" });

export type WebhookValidationResult = { ok: true } | { ok: false; status: 401 | 500 };

/**
 * Phase 1 — must complete, and its result must be acted on, before any
 * HTTP response is sent. Fails closed (500) if the app secret isn't
 * configured, rather than skipping the check; fails with 401 on a
 * missing/invalid signature. Both are logged distinctly so an operator
 * can tell "misconfigured" from "someone's actually probing this."
 */
export function validateWebhookRequest(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string | undefined
): WebhookValidationResult {
  if (!appSecret) {
    logger.error("signal=WEBHOOK_MISCONFIGURED -- WHATSAPP_APP_SECRET not set, refusing all inbound webhook traffic until configured (see docs/DEPLOYMENT.md)");
    return { ok: false, status: 500 };
  }

  if (!verifyWebhookSignature(rawBody, signatureHeader, appSecret)) {
    logger.warn({ signaturePresent: Boolean(signatureHeader) }, "signal=WEBHOOK_SIGNATURE_INVALID -- rejecting request, not authenticated as Meta");
    return { ok: false, status: 401 };
  }

  return { ok: true };
}

/**
 * Phase 2 — only ever called after validateWebhookRequest returned
 * `ok: true` AND the fast 200 has already been sent. Parses the body
 * (returns silently for non-message webhook events -- status updates,
 * read receipts -- same as before) and runs the actual per-message
 * pipeline, including the idempotency check inside handleInboundMessage.
 */
export async function processWebhookBody(parsedBody: unknown, deps: HandleInboundMessageDeps): Promise<void> {
  const inbound = parseInboundMessage(parsedBody);
  if (!inbound) return;
  await handleInboundMessage(inbound, deps);
}
