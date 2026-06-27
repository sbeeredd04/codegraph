import { describe, it, expect, vi } from "vitest";
import {
  buildMessagesRequest,
  extractText,
  anthropicProvider,
  type AnthropicConfig,
  type HttpResponse,
} from "./anthropic-provider.js";

const cfg = (over: Partial<AnthropicConfig> = {}): AnthropicConfig => ({
  apiKey: "sk-test-secret",
  ...over,
});

const okResponse = (body: unknown): HttpResponse => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("buildMessagesRequest", () => {
  it("targets the default Anthropic messages endpoint", () => {
    expect(buildMessagesRequest("hi", cfg()).url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("honours a custom base URL (for proxies / BYO endpoints)", () => {
    const { url } = buildMessagesRequest("hi", cfg({ baseURL: "https://proxy.local" }));
    expect(url).toBe("https://proxy.local/v1/messages");
  });

  it("sets the auth and version headers", () => {
    const { init } = buildMessagesRequest("hi", cfg());
    expect(init.headers["x-api-key"]).toBe("sk-test-secret");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.method).toBe("POST");
  });

  it("defaults the model to claude-haiku-4-5 and carries the prompt", () => {
    const { init } = buildMessagesRequest("describe me", cfg());
    const body = JSON.parse(init.body) as { model: string; max_tokens: number; messages: { role: string; content: string }[] };
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: "user", content: "describe me" }]);
  });

  it("honours a custom model and max tokens (BYOM)", () => {
    const { init } = buildMessagesRequest("x", cfg({ model: "claude-opus-4-8", maxTokens: 1024 }));
    const body = JSON.parse(init.body) as { model: string; max_tokens: number };
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.max_tokens).toBe(1024);
  });
});

describe("extractText", () => {
  it("concatenates text blocks", () => {
    expect(extractText({ content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] })).toBe("hello world");
  });

  it("ignores non-text blocks", () => {
    expect(extractText({ content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "kept" }] })).toBe("kept");
  });

  it("returns empty string for a malformed or empty response", () => {
    expect(extractText({})).toBe("");
    expect(extractText({ content: [] })).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText("nope")).toBe("");
  });
});

describe("anthropicProvider (ModelProvider impl)", () => {
  it("ids itself by the configured model", () => {
    expect(anthropicProvider(cfg(), vi.fn()).id).toBe("anthropic:claude-haiku-4-5");
  });

  it("posts the prompt and returns the extracted text", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ content: [{ type: "text", text: "a summary" }] }));
    const provider = anthropicProvider(cfg(), fetchImpl);
    const out = await provider.describe("the prompt");
    expect(out).toBe("a summary");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as { headers: Record<string, string> }).headers["x-api-key"]).toBe("sk-test-secret");
  });

  it("throws on a non-2xx response WITHOUT leaking the api key", async () => {
    const fetchImpl = vi.fn(async (): Promise<HttpResponse> => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "unauthorized",
    }));
    const provider = anthropicProvider(cfg(), fetchImpl);
    await expect(provider.describe("x")).rejects.toThrow(/401/);
    await expect(provider.describe("x")).rejects.not.toThrow(/sk-test-secret/);
  });
});
