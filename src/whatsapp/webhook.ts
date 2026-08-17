/**
 * Platform Integration layer — Meta WhatsApp Cloud API webhook.
 * Explicitly NOT part of the six-document kernel spec (Runtime §7:
 * "Platform Integration specifics (WhatsApp, timeout policy)" is
 * out of scope of those documents by design).
 */

import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface InboundWhatsAppMessage {
  id: string; // Meta's message.id (wamid...) — used for webhook delivery
              // idempotency (P0 finding, see docs/ADL.md / HANDOVER §6
              // item 3). Required, not optional: every real delivery from
              // Meta has one; a caller with no real id (a test harness)
              // must supply an explicit synthetic value rather than this
              // silently defaulting to something and masking the gap.
  from: string; // phone number, E.164-ish as WhatsApp sends it
  text: string;
  timestamp: string;
}

// server.ts captures the raw request bytes via express.json()'s `verify`
// hook, before JSON parsing, and stashes them here. Signature verification
// MUST run over the exact raw bytes Meta sent, not JSON.stringify(req.body)
// -- re-serializing can change whitespace/key order and break a
// legitimate signature, producing false rejections rather than the
// security property this is meant to provide.
export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/** GET /webhook — Meta's verification handshake when you register the webhook URL. */
export function handleVerification(req: Request, res: Response): void {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header (P0 security finding —
 * webhook.ts's POST handler previously processed any request body with
 * zero authentication; anyone who could reach the endpoint could trigger
 * the full pipeline: Call A, Call B, state mutation, an outbound message
 * sent as this business). Meta signs every webhook delivery with an
 * HMAC-SHA256 of the raw body, keyed by the app secret (from the Meta App
 * Dashboard, NOT the same value as WHATSAPP_ACCESS_TOKEN or
 * WHATSAPP_VERIFY_TOKEN — those authenticate outbound calls and the
 * one-time verification handshake respectively; this authenticates each
 * individual inbound delivery). Compared with a constant-time comparison
 * so response timing can't be used to guess the correct signature one
 * byte at a time.
 */
export function verifyWebhookSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!rawBody || !signatureHeader) return false;

  const [scheme, providedHex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !providedHex) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody).digest("hex");

  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(providedHex, "hex");
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false -- checked explicitly so a malformed/truncated header produces
  // a clean rejection instead of an uncaught exception.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

/**
 * Parses Meta's webhook payload shape into a simple inbound message, or
 * null if the payload isn't a text message (status updates, read receipts,
 * etc. also arrive on this endpoint and should be ignored).
 */
export function parseInboundMessage(body: any): InboundWhatsAppMessage | null {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message || message.type !== "text") return null;
    if (!message.id) return null; // no id -- nothing to dedup against, treat as unparseable rather than let it bypass idempotency tracking silently

    return {
      id: message.id,
      from: message.from,
      text: message.text.body,
      timestamp: new Date(Number(message.timestamp) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}
