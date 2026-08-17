/**
 * Model router — not part of the six-document spec (that's deliberate;
 * Runtime/Prompt Spec define WHAT each call needs as input/output, not
 * which model serves it). This is the "your original requirement" layer:
 * NVIDIA API primary, Ollama local fallback, multiple models in rotation
 * to avoid rate limits.
 *
 * Both NVIDIA NIM and Ollama expose OpenAI-compatible /chat/completions
 * endpoints, so one client shape covers both — only base URL, model name,
 * and auth header differ.
 *
 * Exposes a `tier` param ("fast" | "quality") because Call A (structured
 * extraction) and Call B (conversational generation) have different
 * requirements — Arch2 flagged this as a good optimization consistent with
 * the spec, worth doing once latency is actually measured. Implemented now
 * since threading the param through costs nothing; the actual model
 * assignment per tier is left easy to retune in .env once you've benchmarked.
 */

import pino from "pino";

const logger = pino({ name: "router" });

export type ModelTier = "fast" | "quality";

/**
 * Type of chatCompletion itself — exported so callA.ts/callB.ts/pipeline.ts
 * can accept an override of this exact shape. Added for the item 5A
 * Validation Harness (production handoff): lets the harness swap in
 * scripted responses at the ONE seam that actually makes a network call,
 * while every other line of production code (prompt assembly, schema
 * validation, retry logic) runs completely unchanged. Default behavior
 * (no override supplied) is exactly what it was before this existed.
 */
export type ChatCompletionFn = (params: ChatCompletionParams) => Promise<string>;

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: { fast: string; quality: string };
}

function loadProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  if (process.env.NVIDIA_API_KEY) {
    providers.push({
      name: "nvidia",
      baseUrl: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY,
      models: {
        fast: process.env.NVIDIA_MODEL_FAST ?? "meta/llama-3.1-8b-instruct",
        quality: process.env.NVIDIA_MODEL_QUALITY ?? "meta/llama-3.1-70b-instruct",
      },
    });
  }

  // Ollama fallback — local, no API key. Assumes `ollama serve` is running
  // and the referenced models have been pulled.
  providers.push({
    name: "ollama",
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    apiKey: undefined,
    models: {
      fast: process.env.OLLAMA_MODEL_FAST ?? "llama3.1:8b",
      quality: process.env.OLLAMA_MODEL_QUALITY ?? "llama3.1:70b",
    },
  });

  if (providers.length === 0) {
    throw new Error("No model providers configured — set NVIDIA_API_KEY or ensure Ollama is reachable.");
  }

  return providers;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  messages: ChatMessage[];
  tier: ModelTier;
  temperature?: number;
  jsonMode?: boolean; // Call A wants strict JSON out; Call B does not
}

/**
 * Sends a chat completion request, trying providers in order (NVIDIA first,
 * Ollama fallback) until one succeeds. Does not itself retry the SAME
 * provider on failure — that's the caller's job (see callA.ts's schema
 * -validation retry, which is a different concern: retrying a malformed
 * response vs. falling back on a dead/rate-limited provider).
 */
export async function chatCompletion(params: ChatCompletionParams): Promise<string> {
  const providers = loadProviders();
  let lastError: unknown;

  for (const provider of providers) {
    try {
      const model = params.tier === "fast" ? provider.models.fast : provider.models.quality;
      logger.info({ provider: provider.name, model, tier: params.tier }, "chat completion request");

      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: params.temperature ?? 0.3,
          ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (!res.ok) {
        throw new Error(`${provider.name} responded ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { choices: { message: { content: string } }[] };
      return data.choices[0].message.content;
    } catch (err) {
      logger.warn({ provider: provider.name, err: String(err) }, "provider failed, trying next");
      lastError = err;
    }
  }

  throw new Error(`All model providers failed. Last error: ${String(lastError)}`);
}
