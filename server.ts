import "dotenv/config";
import express from "express";
import pino from "pino";
import { handleVerification, type RequestWithRawBody } from "./src/whatsapp/webhook.js";
import { validateWebhookRequest, processWebhookBody } from "./src/whatsapp/webhookRoute.js";
import { sendWhatsAppMessage } from "./src/whatsapp/sender.js";
import { loadDomainPackage } from "./src/domain/domainLoader.js";
import { verifyDomainPackage } from "./src/verify/verifyDomainPackage.js";
import { ConversationStore } from "./src/store/store.js";
import { WebhookIdempotencyStore } from "./src/store/webhookIdempotencyStore.js";
import { ConfigurationService, type DomainRef } from "./src/services/configurationService.js";
import { ConversationService } from "./src/services/conversationService.js";
import { requireDashboardAuth } from "./src/dashboard/auth.js";
import { buildDashboardRouter } from "./src/dashboard/routes.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ name: "server" });
const app = express();
// `verify` runs on every JSON body BEFORE parsing -- capturing the exact
// raw bytes here is required for webhook signature verification (P0
// finding, see docs/ADL.md). Only the /webhook route ever reads
// req.rawBody; every other route ignores it, this is not a behavior
// change for the dashboard's JSON endpoints.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = buf;
    },
  })
);

const DOMAIN_PATH = "domains/website-development.yaml";

// Mutable reference — this is what makes hot reload possible. server.ts
// itself never reads `domain` directly again after this point; every
// request reads domainRef.current fresh, so ConfigurationService swapping
// it after a successful save takes effect on the very next request, no
// restart needed. Previously `domain` was a frozen const loaded once at
// boot — that had to change for the dashboard's hot-reload requirement to
// be real rather than cosmetic.
const domainRef: DomainRef = { current: loadDomainPackage(DOMAIN_PATH) };

// ---------------------------------------------------------------------
// DEPLOYMENT GATE — layer 3 of 3 (production handoff item 4 follow-up).
// This is the one that actually can't be bypassed: it runs regardless of
// HOW the process was launched (npm start, a Docker CMD calling `node`
// directly, a process manager, anything). The other two layers —
// package.json's `prestart` hook and the CI workflow — exist for faster
// feedback (catch it before merge, catch it before even trying to boot),
// but neither of those can be relied on as the actual last line of
// defense, since both can be skipped depending on how deployment is
// wired. This one can't be: if the package is invalid, the process never
// starts serving traffic. Warnings do not block boot, per explicit
// instruction not to tighten Level 2 checks into hard failures.
// ---------------------------------------------------------------------
{
  const report = verifyDomainPackage(domainRef.current);
  for (const w of report.issues.filter((i) => i.level === "warning")) {
    logger.warn({ code: w.code, path: w.path }, w.message);
  }
  if (!report.valid) {
    for (const e of report.issues.filter((i) => i.level === "error")) {
      logger.error({ code: e.code, path: e.path }, e.message);
    }
    logger.error(
      { package: report.packageName, version: report.packageVersion },
      "REFUSING TO START — business package failed verification. Fix the errors above and restart."
    );
    process.exit(1);
  }
  logger.info({ package: report.packageName, version: report.packageVersion }, "business package verified, starting");
}

// ---------------------------------------------------------------------
// ENV VAR CHECK — extends the same "fail loud at boot" principle to
// environment configuration (Operations checklist: "environment variables
// documented"). Warnings only, not a hard fail — legitimate to boot
// without WhatsApp/model credentials for local testing (e.g. this is how
// the 5A harness runs). See .env.example and docs/DEPLOYMENT.md for what
// each variable actually does and what breaks without it.
// ---------------------------------------------------------------------
{
  const required = [
    { name: "NVIDIA_API_KEY", note: "no model provider configured -- falls back to Ollama, which needs `ollama serve` running locally" },
    { name: "WHATSAPP_ACCESS_TOKEN", note: "outbound WhatsApp sends will fail" },
    { name: "WHATSAPP_PHONE_NUMBER_ID", note: "outbound WhatsApp sends will fail" },
    { name: "WHATSAPP_VERIFY_TOKEN", note: "webhook verification handshake will fail" },
    { name: "WHATSAPP_APP_SECRET", note: "P0 finding: webhook signature verification will refuse ALL inbound webhook traffic (fails closed, not open) until this is set -- see docs/DEPLOYMENT.md" },
    { name: "OPERATOR_PASSWORD_HASH", note: "the operator dashboard will refuse all requests -- see bin/hash-password.ts" },
  ];
  for (const { name, note } of required) {
    if (!process.env[name]) {
      logger.warn({ variable: name }, `Environment variable ${name} is not set -- ${note}`);
    }
  }
}

const toneConfig = readFileSync("config/tone.md", "utf-8");
const store = new ConversationStore();
const idempotencyStore = new WebhookIdempotencyStore();

// Plain health check for the hosting platform (e.g. Render's
// healthCheckPath) -- deliberately separate from GET /webhook, which
// only returns 200 for Meta's real verification handshake (a bare GET
// with no hub.mode/hub.verify_token query params 403s there, confirmed
// by reading handleVerification() directly -- see docs/DEPLOYMENT.md).
// A platform health check needs something that returns 200 unconditionally
// once the process is up; this route being reached at all already proves
// that, since it's registered after the boot-time domain verification
// gate above (an invalid domain package exits the process before this
// point is ever reached).
app.get("/health", (_req, res) => {
  res.sendStatus(200);
});

app.get("/webhook", handleVerification);

app.post("/webhook", async (req, res) => {
  // P0 finding (see docs/ADL.md): this endpoint previously processed any
  // POST body with zero authentication -- anyone who could reach it could
  // trigger the full pipeline (Call A, Call B, a state mutation, an
  // outbound message sent as this business) as any phone number they
  // chose to put in the body. Validated BEFORE anything else runs,
  // including before the fast 200 ack -- see webhookRoute.ts for why
  // validation and processing are two separate functions/awaits, not one.
  const validation = validateWebhookRequest(
    (req as RequestWithRawBody).rawBody,
    req.header("x-hub-signature-256"),
    process.env.WHATSAPP_APP_SECRET
  );
  if (!validation.ok) {
    res.sendStatus(validation.status);
    return;
  }

  // Acknowledge immediately — WhatsApp expects a fast 200, and the actual
  // reply goes out asynchronously via sendWhatsAppMessage.
  res.sendStatus(200);

  await processWebhookBody(req.body, {
    store,
    idempotencyStore,
    domain: domainRef.current, // read fresh each request -- reflects any hot-reloaded config
    toneConfig,
    sendMessage: sendWhatsAppMessage,
  });
});

// ---------------------------------------------------------------------
// OPERATOR DASHBOARD — new scope, parallel to the bot itself. Same
// server/process, no new infrastructure, per the explicit deployment
// scope. Auth applies to the whole /dashboard and /api/dashboard surface;
// the bot's own /webhook route is untouched by it.
// ---------------------------------------------------------------------
const configService = new ConfigurationService(DOMAIN_PATH, domainRef);
const conversationService = new ConversationService(store);

app.use("/api/dashboard", requireDashboardAuth, buildDashboardRouter(configService, conversationService));
app.use("/dashboard", requireDashboardAuth, express.static(path.join(__dirname, "src/dashboard/public")));

const port = process.env.PORT ?? 3000;
app.listen(port, () => logger.info({ port }, "server listening"));
