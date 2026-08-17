/**
 * Per-lead conversation persistence. Not part of the six-document kernel
 * spec — this is the Platform/Infra layer.
 *
 * One JSON file per phone number under `data/`. Originally scaffolded with
 * better-sqlite3; switched after hitting native-binary compile issues in a
 * sandboxed build — but on reflection this is the more appropriate choice
 * at this scale anyway, not just a workaround: single Node process, lookups
 * are always by phone number (no relational queries), no concurrent-write
 * contention to speak of. SQLite's advantages weren't buying anything here,
 * and a native dependency is a real, recurring deployment-build risk (the
 * same node-gyp compile has to happen wherever this is deployed — Render,
 * Railway, etc. — not just in this sandbox). Revisit only if volume or
 * query needs actually justify it later.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ConversationRecord } from "../engine/types.js";

export class ConversationStore {
  private dir: string;

  constructor(dir = "data/conversations") {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private pathFor(phone: string): string {
    // Phone numbers are digits (WhatsApp sends them without '+'), safe as filenames.
    return join(this.dir, `${phone}.json`);
  }

  get(phone: string): ConversationRecord | null {
    const path = this.pathFor(phone);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ConversationRecord;
  }

  /**
   * Added for the operator dashboard's ConversationService — NOT called by
   * the dashboard directly (the governing rule is the dashboard never
   * touches ConversationStore; this is what ConversationService wraps).
   * Reads every record in the directory. Fine at this project's actual
   * scale (single business, JSON-file store, per store.ts's own header
   * comment) — would need pagination if that scale assumption changes.
   */
  list(): ConversationRecord[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as ConversationRecord);
  }

  getOrCreate(phone: string, businessPackageVersion: string | null = null): ConversationRecord {
    const existing = this.get(phone);
    if (existing) return existing;

    const fresh: ConversationRecord = {
      phone,
      variables: {},
      conversation: {
        lifecycle: "active",
        current_objective: null,
        last_customer_activity: null,
        last_agent_activity: null,
        recommendation_delivered: false,
      },
      turn: 0,
      business_package_version: businessPackageVersion,
      automation_paused: false,
      paused_reason: null,
      paused_at: null,
      paused_by: null,
      last_objective: null,
      last_target: null,
      repeat_count: 0,
    };
    this.save(fresh);
    return fresh;
  }

  save(record: ConversationRecord): void {
    writeFileSync(this.pathFor(record.phone), JSON.stringify(record, null, 2), "utf-8");
  }
}
