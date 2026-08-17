/**
 * Dashboard API routes. This file, and only this file plus the two
 * services it calls, may know that ConfigurationService/ConversationService
 * exist — the frontend (public/*.js) only ever talks to these HTTP
 * endpoints. Nothing here touches a filesystem path or ConversationStore
 * directly; every handler is a thin call into one of the two services.
 */

import { Router } from "express";
import type { ConfigurationService, EditableChanges } from "../services/configurationService.js";
import type { ConversationService } from "../services/conversationService.js";

export function buildDashboardRouter(configService: ConfigurationService, conversationService: ConversationService): Router {
  const router = Router();

  // ---- Configuration ----

  router.get("/config", (_req, res) => {
    const config = configService.getConfiguration();
    const metadata = configService.getMetadata();
    // Only the editable subtrees + read-only metadata go over the wire —
    // kernel-structural fields (domain.variables, completion_requirement,
    // etc.) are never sent to the client at all, not just hidden by the
    // frontend. A network tab inspection would show nothing more than the
    // UI itself displays.
    res.json({
      pricing_ranges: config.business?.pricing?.ranges ?? {},
      business_knowledge_topics: config.business_knowledge.topics,
      available_options: config.domain.recommendation.available_options,
      metadata,
    });
  });

  router.post("/config/preview", (req, res) => {
    const changes = req.body as EditableChanges;
    try {
      const result = configService.previewChanges(changes);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  router.post("/config/save", async (req, res) => {
    const changes = req.body as EditableChanges;
    try {
      const result = await configService.saveChanges(changes);
      res.status(result.success ? 200 : 422).json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ---- Conversations ----

  router.get("/conversations", (req, res) => {
    const lifecycle = req.query.lifecycle as string | undefined;
    const records = conversationService.list(lifecycle ? { lifecycle: lifecycle as any } : undefined);
    // List view only needs enough to render a row -- not the full
    // variable evidence history for every conversation.
    res.json(
      records.map((r) => ({
        phone: r.phone,
        lifecycle: r.conversation.lifecycle,
        recommendation_delivered: r.conversation.recommendation_delivered,
        automation_paused: r.automation_paused,
        last_activity: r.conversation.last_agent_activity ?? r.conversation.last_customer_activity,
      }))
    );
  });

  router.get("/conversations/search", (req, res) => {
    const { phone, lifecycle, customerName } = req.query;
    try {
      const results = conversationService.search({
        phone: phone as string | undefined,
        lifecycle: lifecycle as any,
        customerName: customerName as string | undefined,
      });
      res.json(results.map((r) => ({ phone: r.phone, lifecycle: r.conversation.lifecycle })));
    } catch (e) {
      // customerName search deliberately throws -- see ConversationService's
      // own comment. Surfaced here as a clear 400, not a 500, since it's a
      // known, explained scope gap, not a server error.
      res.status(400).json({ error: String(e) });
    }
  });

  router.get("/conversations/:phone", (req, res) => {
    const record = conversationService.get(req.params.phone);
    if (!record) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    // Read-only kernel state shown for context, per scope — no editing
    // capability exists anywhere in this router for conversation state.
    res.json({
      phone: record.phone,
      lifecycle: record.conversation.lifecycle,
      recommendation_delivered: record.conversation.recommendation_delivered,
      automation_paused: record.automation_paused,
      paused_reason: record.paused_reason,
      paused_by: record.paused_by,
      paused_at: record.paused_at,
      variables: record.variables,
      turn: record.turn,
    });
  });

  router.post("/conversations/:phone/pause", (req, res) => {
    const { reason, operator } = req.body as { reason?: string; operator?: string };
    if (!reason) {
      res.status(400).json({ success: false, error: "A reason is required to pause a conversation." });
      return;
    }
    const result = conversationService.pause(req.params.phone, reason, operator ?? "dashboard");
    res.status(result.success ? 200 : 404).json(result);
  });

  router.post("/conversations/:phone/resume", (req, res) => {
    const result = conversationService.resume(req.params.phone);
    res.status(result.success ? 200 : 404).json(result);
  });

  return router;
}
