/**
 * Webhook delivery idempotency. Meta's Cloud API retries a webhook POST
 * if it doesn't get a fast, successful-looking response, so the same
 * `message.id` can legitimately arrive more than once. Explicitly a
 * platform-layer concern, not the kernel's (per HANDOVER §6 item 3): the
 * kernel (Runtime §1) only knows "the customer's latest message," it has
 * no concept of "this exact delivery attempt." Without this, a retried
 * delivery re-runs the full pipeline (a second Call A/Call B, a second
 * state mutation, a second outbound reply for something the customer
 * only sent once).
 *
 * Persisted to disk, not an in-memory Set — same reasoning
 * ConversationStore's own header comment gives for persisting
 * conversation state: this project's build history includes multiple
 * mid-round container/process resets (ADL-020, ADL-021), and Meta's own
 * retry window is measured in hours, comfortably longer than the gap a
 * restart would otherwise create. An in-memory-only store would silently
 * lose its dedup history on every restart, reopening exactly the window
 * this is meant to close.
 *
 * Single JSON file holding a pruned list, not one file per ID
 * (ConversationStore's one-file-per-key pattern isn't a good fit here —
 * message IDs are never looked up individually outside this check, and
 * there's no natural bound on how many distinct IDs would accumulate as
 * separate files). Pruned to a retention window rather than kept forever:
 * Meta does not redeliver indefinitely, and an unbounded ID list is its
 * own operational problem.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface SeenEntry {
  id: string;
  seenAt: string; // ISO timestamp
}

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24h -- comfortably beyond Meta's documented retry window

export class WebhookIdempotencyStore {
  private path: string;
  private retentionMs: number;

  constructor(path = "data/webhook-seen-messages.json", retentionMs = DEFAULT_RETENTION_MS) {
    this.path = path;
    this.retentionMs = retentionMs;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, JSON.stringify([]), "utf-8");
  }

  private read(): SeenEntry[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Corrupt or unreadable file -- fail toward "treat as not-yet-seen"
      // rather than crashing the webhook path over an idempotency-
      // tracking problem. Worst case under this failure mode is a
      // duplicate gets processed once more, not that the bot goes down
      // entirely; asymmetric on purpose, same direction the kill switch
      // and deployment gate lean (loud logging, not a hard crash) for a
      // non-kernel operational concern.
      return [];
    }
  }

  /**
   * Returns true if `id` was already recorded (this delivery is a
   * duplicate) and leaves the store untouched; returns false and records
   * `id` if this is the first time it's been seen. Deliberately one
   * atomic method rather than separate has()/record() calls -- both
   * operations are synchronous file I/O with no `await` between them, so
   * a single method keeps the check-then-write from ever being split
   * across two calls a future caller could interleave incorrectly.
   */
  checkAndRecord(id: string): boolean {
    const now = Date.now();
    const entries = this.read().filter((e) => now - new Date(e.seenAt).getTime() < this.retentionMs);

    const alreadySeen = entries.some((e) => e.id === id);
    if (!alreadySeen) {
      entries.push({ id, seenAt: new Date(now).toISOString() });
      writeFileSync(this.path, JSON.stringify(entries), "utf-8");
    } else {
      // Still write back the pruned list even on a duplicate hit, so an
      // old store that's accumulated a long tail of expired entries
      // doesn't just grow forever between "new id" events.
      writeFileSync(this.path, JSON.stringify(entries), "utf-8");
    }
    return alreadySeen;
  }
}
