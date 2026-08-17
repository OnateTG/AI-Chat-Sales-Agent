import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { DomainPackage } from "./types.js";

/**
 * Loads and parses a domain package YAML file. Deliberately thin — no
 * validation logic beyond what YAML parsing gives us for free right now.
 * A schema-validation pass (zod, matching domain/types.ts) is the natural
 * next hardening step once a second domain package exists to validate
 * against (per the project's own "engineer only what's shown to be needed"
 * discipline — one domain package isn't enough evidence to know which
 * validation failures actually occur in practice).
 */
export function loadDomainPackage(path: string): DomainPackage {
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw) as DomainPackage;

  if (!parsed?.domain?.name) {
    throw new Error(`Domain package at ${path} is missing required "domain.name" — refusing to load.`);
  }

  return parsed;
}
