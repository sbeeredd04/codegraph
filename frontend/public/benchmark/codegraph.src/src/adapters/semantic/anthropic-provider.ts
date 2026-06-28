// Anthropic ModelProvider (Epic 4 / BYOM, AD-5): the LLM half of the semantic
// layer. Implements the core ModelProvider port with a single Messages-API call
// over the global fetch — no SDK dependency (stdlib-first). Bring-your-own: the
// key, model, and even the base URL are config, so a user points it at Anthropic
// or a compatible proxy. The request-build and response-parse are pure functions
// (tested without a network); the network call is injected for the same reason.

import type { ModelProvider } from "../../core/ports.js";

export interface AnthropicConfig {
  /** Bring-your-own API key. Never hardcoded — supplied from settings/env at the
   * composition root, never logged. */
  readonly apiKey: string;
  /** Model id (default: claude-haiku-4-5 — cheap, fast, ample for node summaries). */
  readonly model?: string;
  /** Override the API base (proxies, gateways, compatible endpoints). */
  readonly baseURL?: string;
  /** Response token ceiling (default 512 — summaries are short). */
  readonly maxTokens?: number;
  /** Anthropic API version header (default 2023-06-01). */
  readonly anthropicVersion?: string;
}

/** The slice of an HTTP response this adapter needs — keeps the injected fetch
 * trivially fakeable in tests while matching the global `fetch`'s Response. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface HttpInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export type FetchLike = (url: string, init: HttpInit) => Promise<HttpResponse>;

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_VERSION = "2023-06-01";

/** Build the Messages-API request for a single-turn prompt. Pure. */
export function buildMessagesRequest(prompt: string, cfg: AnthropicConfig): { url: string; init: HttpInit } {
  const base = (cfg.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    url: `${base}/v1/messages`,
    init: {
      method: "POST",
      headers: {
        "x-api-key": cfg.apiKey,
        "anthropic-version": cfg.anthropicVersion ?? DEFAULT_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model ?? DEFAULT_MODEL,
        max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    },
  };
}

/** Concatenate the text blocks of a Messages response into one string. Pure and
 * forgiving: any non-text block or malformed payload contributes nothing. */
export function extractText(responseJson: unknown): string {
  if (typeof responseJson !== "object" || responseJson === null) return "";
  const content = (responseJson as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } =>
      typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text)
    .join("");
}

/**
 * A {@link ModelProvider} backed by the Anthropic Messages API. The `fetchImpl`
 * defaults to the global fetch; tests inject a fake. Errors carry the HTTP
 * status and the response body — but never the api key.
 */
export function anthropicProvider(cfg: AnthropicConfig, fetchImpl: FetchLike = fetch): ModelProvider {
  const model = cfg.model ?? DEFAULT_MODEL;
  return {
    id: `anthropic:${model}`,
    describe: async (prompt: string): Promise<string> => {
      const { url, init } = buildMessagesRequest(prompt, cfg);
      const res = await fetchImpl(url, init);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`anthropic: request failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      return extractText(await res.json());
    },
  };
}
