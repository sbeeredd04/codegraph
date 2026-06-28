// Semantic enrichment (Epic 4 / BYOM, AD-5): turn a structural node into a
// human-readable summary/intent/role using a bring-your-own model. This module
// is the PURE engine — it builds the prompt, parses the reply, and orchestrates
// caching, but does NO I/O itself (AD-1). The model call and the cache store are
// injected: a `ModelProvider` (the outbound port) and an `EnrichmentCache`. The
// adapter layer supplies the real LLM + on-disk cache; tests supply fakes.

import type { GraphNode } from "../graph/types.js";
import type { ModelProvider } from "../ports.js";

/** What enrichment a node carries, once a model has described it. */
export interface NodeEnrichment {
  /** One line: what this node does. */
  readonly summary: string;
  /** Why it exists — the purpose it serves. */
  readonly intent: string;
  /** Its architectural role (e.g. "port", "adapter", "orchestrator", "value object"). */
  readonly role: string;
}

/**
 * The inputs a model sees to describe a node: the node itself plus its immediate
 * graph neighbourhood (what it calls, what calls it). The body isn't available —
 * the graph stores signatures, not source — so the call neighbourhood is the
 * model's main behavioural signal.
 */
export interface EnrichmentContext {
  readonly node: GraphNode;
  /** Names of the node's outbound call/dependency targets. */
  readonly calls: readonly string[];
  /** Names of the node's inbound callers (context only — does not affect the cache key). */
  readonly calledBy: readonly string[];
}

/**
 * Outbound port: a content-addressed store of enrichments. Keyed by
 * {@link enrichmentKey} so an unchanged node is never re-described (no re-spend).
 * Sync or async — the adapter decides (in-memory map, workspace file, etc.).
 */
export interface EnrichmentCache {
  get(key: string): Promise<NodeEnrichment | undefined> | NodeEnrichment | undefined;
  set(key: string, value: NodeEnrichment): Promise<void> | void;
}

/** FNV-1a (32-bit) over a string → 8-char hex. Pure and deterministic; good
 * enough for cache addressing (a collision only yields a shared, identical-by-
 * construction enrichment, which is harmless). */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The cache address for a node's enrichment. Built from the fields that change a
 * node's MEANING — kind, name, signature, and its outbound call set — and
 * pointedly NOT from its location or its callers. So a node that merely moved (or
 * gained a new dependent) keeps its cached enrichment, while one whose signature
 * or behaviour shifted is re-described. Call order doesn't matter (it's a set).
 */
export function enrichmentKey(ctx: EnrichmentContext): string {
  const sig = ctx.node.signature ?? "";
  const calls = [...ctx.calls].sort().join(",");
  return fnv1a(`${ctx.node.kind}|${ctx.node.name}|${sig}|${calls}`);
}

const fmtList = (items: readonly string[]): string =>
  items.length ? items.join(", ") : "(none)";

/**
 * Build the model prompt for one node. Deterministic (so the same node yields the
 * same prompt, and thus a cacheable request) and explicit about the required
 * shape: a strict JSON object with `summary`, `intent`, and `role`.
 */
export function buildEnrichmentPrompt(ctx: EnrichmentContext): string {
  const { node } = ctx;
  return [
    "You are documenting one node of a software code graph. Describe it concisely.",
    "",
    `Kind: ${node.kind}`,
    `Name: ${node.name}`,
    `Address: ${node.address}`,
    `Signature: ${node.signature ?? "(unknown)"}`,
    `Calls: ${fmtList(ctx.calls)}`,
    `Called by: ${fmtList(ctx.calledBy)}`,
    "",
    "Reply with ONLY a JSON object, no prose, no code fence, with exactly these keys:",
    '  "summary": one sentence describing what this node does,',
    '  "intent":  why it exists — the purpose it serves in the system,',
    '  "role":    its architectural role in one or two words (e.g. port, adapter, orchestrator, value object).',
  ].join("\n");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const EMPTY: NodeEnrichment = { summary: "", intent: "", role: "" };

/**
 * Parse a model reply into a {@link NodeEnrichment}, tolerating the ways models
 * wrap JSON: code fences, leading/trailing prose. Extracts the first balanced
 * `{...}` span and coerces missing fields to empty strings. Never throws — an
 * unparseable reply yields empty fields so a bad response degrades gracefully.
 */
export function parseEnrichment(raw: string): NodeEnrichment {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return EMPTY;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return { summary: str(obj.summary), intent: str(obj.intent), role: str(obj.role) };
  } catch {
    return EMPTY;
  }
}

/**
 * Enrich a node, cache-first: return the cached enrichment if present, otherwise
 * ask the model once, store the result, and return it. The provider is only ever
 * called on a genuine miss — that's the "no re-spend" guarantee (AD-5). Pure
 * orchestration; all I/O is behind the two injected ports.
 */
export async function enrichNode(
  ctx: EnrichmentContext,
  provider: ModelProvider,
  cache: EnrichmentCache,
): Promise<NodeEnrichment> {
  const key = enrichmentKey(ctx);
  const cached = await cache.get(key);
  if (cached) return cached;
  const enrichment = parseEnrichment(await provider.describe(buildEnrichmentPrompt(ctx)));
  await cache.set(key, enrichment);
  return enrichment;
}
