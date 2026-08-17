/**
 * Dashboard auth — HTTP Basic Auth, checked against OPERATOR_PASSWORD_HASH.
 *
 * Deliberately not a session/cookie/token system: the scope is explicitly
 * "single shared password... no accounts, no database, no roles." Basic
 * Auth is the simplest thing that's actually correct for that scope —
 * the browser handles credential caching and resending natively, nothing
 * to build or maintain on top of it. Username is ignored; only the
 * password field is checked.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyPassword } from "../services/authUtil.js";

export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  const configuredHash = process.env.OPERATOR_PASSWORD_HASH;
  if (!configuredHash) {
    res.status(500).send("Dashboard auth is not configured — OPERATOR_PASSWORD_HASH is not set. See bin/hash-password.ts.");
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Operator Dashboard"');
    res.status(401).send("Authentication required.");
    return;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  const password = decoded.split(":").slice(1).join(":"); // everything after the first ':' — password could itself contain ':'

  if (!verifyPassword(password, configuredHash)) {
    res.set("WWW-Authenticate", 'Basic realm="Operator Dashboard"');
    res.status(401).send("Invalid credentials.");
    return;
  }

  next();
}
