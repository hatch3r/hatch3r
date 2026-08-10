import type { AdapterOutput } from "../types.js";
import {
  renderCodexMcpServers,
  type CodexMcpEntry,
} from "./codexMcp.js";
import {
  CODEX_CONFIG_PATH,
  CODEX_TOML_BLOCK_END,
  CODEX_TOML_BLOCK_START,
  assertNoCodexMcpCollisions,
  mergeCodexTomlManagedRegion,
  parseCodexToml,
  preflightCodexToml,
  type CodexTomlPreflight,
} from "./codexToml.js";

export type { CodexMcpEntry } from "./codexMcp.js";

export interface CodexMcpProjection {
  managedBody: string;
  serverNames: string[];
}

export function projectCodexMcpServers(
  servers: Record<string, CodexMcpEntry>,
): CodexMcpProjection {
  const projected = renderCodexMcpServers(servers, "project");
  if (projected.body) parseCodexToml(projected.body, "generated Codex MCP TOML");
  return { managedBody: projected.body, serverNames: projected.names };
}

/** Build a validated managed project-config output without touching user bytes. */
export function buildCodexConfigOutput(
  preflight: CodexTomlPreflight,
  servers: Record<string, CodexMcpEntry>,
  inlineHooksToml = "",
): AdapterOutput | null {
  const projected = projectCodexMcpServers(servers);
  assertNoCodexMcpCollisions(preflight, projected.serverNames);
  const managedBody = [projected.managedBody, inlineHooksToml.trim()].filter(Boolean).join("\n\n");
  if (!managedBody) return null;

  mergeCodexTomlManagedRegion(preflight.content, managedBody);
  const newline = preflight.newline;
  const normalized = managedBody.replace(/\r?\n/g, newline);
  const content = `${CODEX_TOML_BLOCK_START}${newline}${normalized}${newline}${CODEX_TOML_BLOCK_END}${newline}`;
  return { path: CODEX_CONFIG_PATH, content, managedContent: normalized, action: "create" };
}

export function preflightAndBuildCodexConfig(
  existingContent: string,
  servers: Record<string, CodexMcpEntry>,
  inlineHooksToml = "",
): AdapterOutput | null {
  return buildCodexConfigOutput(preflightCodexToml(existingContent), servers, inlineHooksToml);
}
