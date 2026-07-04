import { z } from "zod";
import type { RankedChange } from "../../core/graph/change-feed.js";

// Shared MCP tool kit: the CallToolResult shape every tool returns, the GraphTool
// descriptor the server registers, the two result helpers, and the cross-module data
// types. Factored out so the tool-group modules — read-tools, knowledge-tools,
// drive-tools, overlay-tools — and their assembler (tools.ts) agree on these without a
// circular import between them.

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

/** A ranked "what just changed" feed: the diff of the working tree against a git ref. */
export interface RecentChanges {
  readonly ref: string;
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly moved: number;
  };
  readonly changes: readonly RankedChange[];
}

/**
 * Supplies the live change feed. Injected by the launchable server (it does the I/O:
 * re-scan the working tree, build the git baseline, diff and rank) so the pure tool
 * layer stays I/O-free and testable (AD-1).
 */
export type RecentChangesProvider = (ref: string) => Promise<RecentChanges>;
