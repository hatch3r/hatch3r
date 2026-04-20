/**
 * MCP description static scanner (C7.5-W2B2-H46, D15-F15.6-03, Pillar P6).
 *
 * Scans MCP server configuration metadata (description, args, headers,
 * env values) for prompt-injection / tool-poisoning patterns at sync time.
 *
 * Behaviour: **warn, do not block** per Silent Failure Contract
 * (CONSTITUTION.md §2 P5). Suspicious markers are surfaced through
 * the caller's `warnings[]` collection so operators see them without
 * blocking legitimate MCP servers whose descriptions happen to overlap
 * with a deny pattern.
 *
 * Scope boundaries:
 * - This is a lightweight string-pattern scanner only. Full MCP tool
 *   behaviour analysis (e.g. mcp-scan) is tracked as an external blocker
 *   (C7.5 H62) and is out of scope for this module.
 * - Patterns are reused from `adapters/customization.ts` (general prompt
 *   injection + secrets / RCE patterns) plus MCP-specific markers from
 *   Invariant Labs' 2025 "MCP Tool Poisoning" research.
 *
 * Sources:
 * - Invariant Labs, "MCP Security Notification: Tool Poisoning Attacks"
 *   https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
 *   (accessed 2026-04-19, re-verified 2026-04-20).
 */

import { scanForDeniedPatterns } from "../adapters/customization.js";
import type { McpServerEntry } from "../adapters/mcp-utils.js";

/**
 * MCP tool-poisoning specific patterns observed by Invariant Labs (2025).
 * These complement the general deny patterns in customization.ts with
 * markers that are distinctive of MCP description-injection attacks:
 *
 * 1. Hidden-instruction tags (`<IMPORTANT>`, `<SYSTEM>`) visible to the
 *    model but invisible in many UIs — signature of tool poisoning.
 * 2. "Before using this tool..." preambles that extract sensitive data.
 * 3. "Do not mention / tell / inform the user" secrecy directives.
 * 4. Sensitive-path access prompts (SSH keys, .env, /etc/passwd, etc.).
 * 5. Cross-tool / cross-server hijacking ("when this tool is available,
 *    [other_tool] must...").
 */
const MCP_TOOL_POISONING_PATTERNS: RegExp[] = [
  // Hidden instruction tags used to conceal directives from users in UIs
  // that render plain text but not raw tags.
  /<(?:IMPORTANT|SYSTEM|INSTRUCTIONS?|HIDDEN|SECRET)[\s>]/i,
  // Secrecy directives targeting the user as the concealment target.
  /(?:do\s+not|don['’]t|never)\s+(?:mention|tell|inform|notify|show|display|reveal|report)\s+(?:this|it|the)?\s*(?:to\s+)?(?:the\s+)?user/i,
  // "Before using this tool..." / "Before calling..." data-access preambles.
  /before\s+(?:using|calling|invoking|executing|running)\s+(?:this\s+)?tool[^.]{0,80}?(?:read|access|fetch|load|send|transmit|include)/i,
  // Sensitive filesystem paths frequently named in tool-poisoning payloads.
  /(?:read|access|cat|open|load|send|transmit|include)\s+[^.]{0,60}?(?:~\/\.ssh|\/\.ssh\/|id_rsa|\.env\b|\.aws\/credentials|\/etc\/passwd|\/etc\/shadow|\.kube\/config|\.netrc)/i,
  // Cross-tool hijacking: one server's description influencing another.
  /when\s+(?:this\s+)?tool\s+is\s+(?:available|loaded|present)[^.]{0,80}?(?:other|another|the\s+\w+)\s+tool\s+(?:must|should|will|has\s+to)/i,
  // "The application will crash / fail / error" coercion framing.
  /(?:the\s+)?(?:application|system|agent|tool|call)\s+will\s+(?:crash|fail|error|break|malfunction)\s+(?:if|unless)/i,
  // "Concealing actions" / "without the user noticing" exfiltration framing.
  /(?:without|while)\s+(?:the\s+user|them|anyone)\s+(?:noticing|knowing|seeing|being\s+aware)/i,
  // "Tool will not work unless..." coercion to execute side-effects.
  /(?:this\s+)?tool\s+(?:will\s+not|won['’]t|cannot)\s+work\s+(?:unless|until|without)[^.]{0,80}?(?:read|access|send|transmit|include)/i,
];

/**
 * Fields on an MCP server entry that carry free-form text and therefore
 * can carry injection payloads. These are the surfaces an attacker controls
 * when publishing a malicious MCP package.
 *
 * `command`, `url`, and env/name keys are validated elsewhere
 * (`mcp-utils.ts validateMcpEntry` / `validateServerName`) against strict
 * allowlists, so they are NOT scanned here — the allowlists already
 * constrain their content.
 */
export interface McpScanTarget {
  /** Server name as declared in `mcpServers`. */
  name: string;
  /** Full MCP server entry. */
  entry: McpServerEntry;
}

/**
 * Scan a single MCP server entry for description-injection / tool-poisoning
 * patterns. Returns an array of warning strings (never empty-on-fail: a
 * scan error is itself surfaced as a warning per Silent Failure Contract).
 *
 * Never throws. Callers should append the returned warnings to their
 * collector without branching on length > 0.
 */
export function scanMcpEntry(target: McpScanTarget): string[] {
  const warnings: string[] = [];
  const { name, entry } = target;

  const surfaces: Array<{ label: string; text: string }> = [];

  if (typeof entry._description === "string" && entry._description.length > 0) {
    surfaces.push({ label: "_description", text: entry._description });
  }

  // Args are allowlist-constrained for shell metacharacters in
  // validateMcpEntry, but the content of an arg (e.g. a prompt-string
  // passed via `--system-prompt`) is still a free-form textual surface.
  if (Array.isArray(entry.args)) {
    for (let i = 0; i < entry.args.length; i++) {
      const arg = entry.args[i];
      if (typeof arg === "string" && arg.length > 0) {
        surfaces.push({ label: `args[${i}]`, text: arg });
      }
    }
  }

  // Header VALUES (keys are structural). env values may legitimately
  // contain `${env:VAR}` references, but literal prose there is anomalous.
  if (entry.headers) {
    for (const [k, v] of Object.entries(entry.headers)) {
      if (typeof v === "string" && v.length > 0) {
        surfaces.push({ label: `headers.${k}`, text: v });
      }
    }
  }
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) {
      if (typeof v === "string" && v.length > 0) {
        surfaces.push({ label: `env.${k}`, text: v });
      }
    }
  }

  for (const { label, text } of surfaces) {
    // Reuse the shared deny-pattern list (prompt injection, RCE, secrets,
    // homoglyph-normalised scanning). This keeps one source of truth for
    // general patterns and avoids drift between customization.ts and
    // this scanner.
    const generalHits = scanForDeniedPatterns(text);
    for (const hit of generalHits) {
      warnings.push(
        `MCP server "${name}" ${label}: ${hit} (warn — server still emitted; review before use).`,
      );
    }

    // MCP-specific tool-poisoning patterns are layered on top.
    for (const pattern of MCP_TOOL_POISONING_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        warnings.push(
          `MCP server "${name}" ${label}: tool-poisoning pattern "${truncateMatch(match[0])}" detected (warn — server still emitted; review before use).`,
        );
      }
    }
  }

  return warnings;
}

/**
 * Scan a full MCP server map. Wraps {@link scanMcpEntry} for each server.
 * Callers should invoke this once per `readMcpConfig` result.
 */
export function scanMcpServers(
  servers: Record<string, McpServerEntry>,
): string[] {
  const warnings: string[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    warnings.push(...scanMcpEntry({ name, entry }));
  }
  return warnings;
}

function truncateMatch(s: string): string {
  const trimmed = s.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}
