import { z } from "zod";

// Shared MCP tool kit: the CallToolResult shape every tool returns, the GraphTool
// descriptor the server registers, and the two result helpers. Factored out so the
// tool modules — the read/drive tools in tools.ts and the overlay write tools in
// overlay-tools.ts — agree on these without a circular import between them.

export interface McpToolResult {
  readonly content: { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
  // The SDK's CallToolResult carries an open index signature; mirror it so a
  // handler result is assignable to registerTool's callback return type.
  readonly [key: string]: unknown;
}

export interface GraphTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
  readonly handler: (args: Record<string, unknown>) => McpToolResult | Promise<McpToolResult>;
}

/** Wrap a value as a successful text result (pretty-printed JSON). */
export const ok = (data: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

/** Wrap a message as an error result the agent sees as a failed call. */
export const fail = (message: string): McpToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** A node address input schema, shared by every address-taking tool. */
export const ADDRESS = z.string().min(1).describe("A node address, e.g. ts:src/auth.ts#login");
