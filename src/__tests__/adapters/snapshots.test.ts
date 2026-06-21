/**
 * Adapter Output Snapshot Tests (D3-3)
 *
 * Captures the structural shape of adapter output (file paths, content markers,
 * action types) for regression detection. When adapter generation logic or
 * prompt templates change, snapshot diffs surface unintended regressions.
 *
 * If an intentional change causes a snapshot failure, update the snapshot with:
 *   npx vitest -u src/__tests__/adapters/snapshots.test.ts
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { CursorAdapter } from "../../adapters/cursor.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { HATCH3R_VERSION } from "../../version.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

/**
 * Strip the only volatile substring from adapter output bodies — the embedded
 * `HATCH3R_VERSION` (claude.ts:776 `.claude/settings.json`, claude.ts:989
 * `.claude/hooks/hatch3r-hooks.json`) — so a `bodyHash` over the result is
 * stable across version bumps. Probed 2026-06-06: the resolved version is the
 * sole byte difference between two consecutive generations of every adapter;
 * there are no timestamps in `src/merge/managedBlocks.ts` or `src/adapters/`.
 * Keep this list aligned with any future volatile field added to adapter output.
 */
function normalizeBody(content: string): string {
  return content.split(HATCH3R_VERSION).join("<HATCH3R_VERSION>");
}

/**
 * Normalize adapter output into a deterministic shape suitable for snapshots.
 * `bodyHash` is sha256 over the version-normalized body (`normalizeBody`), so
 * any body change — including a marker-preserving one like a PLATFORM-TOOL
 * substitution regression — flips the hash and fails the snapshot (D3-10),
 * while path churn stays tolerant via the `path` sort. `contentMarkers` remains
 * a secondary human-readable signal that localizes which structural section moved.
 */
function normalizeOutputs(
  outputs: Array<{ path: string; content: string; action: string; managedContent?: string }>,
): Array<{ path: string; action: string; contentMarkers: string[]; hasManagedContent: boolean; bodyHash: string }> {
  return outputs
    .map((o) => ({
      path: o.path,
      action: o.action,
      contentMarkers: extractMarkers(o.content),
      hasManagedContent: o.managedContent !== undefined && o.managedContent !== null,
      bodyHash: createHash("sha256").update(normalizeBody(o.content), "utf-8").digest("hex"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Extract key structural markers from content for snapshot comparison.
 * These markers detect prompt regressions without being sensitive to
 * minor wording changes.
 */
function extractMarkers(content: string): string[] {
  const markers: string[] = [];

  // Detect managed block markers. Issue #76 introduced a YAML-syntax
  // variant for `.yml` / `.yaml` outputs; track both so a regression
  // back to HTML markers in a YAML file shows up as a snapshot diff.
  if (content.includes("<!-- HATCH3R:BEGIN -->")) markers.push("MANAGED_BLOCK");
  if (content.includes("# HATCH3R:BEGIN") && !content.includes("<!-- HATCH3R:BEGIN -->")) {
    markers.push("MANAGED_BLOCK_YAML");
  }

  // Detect frontmatter
  if (content.startsWith("---")) markers.push("FRONTMATTER");

  // Detect common structural sections
  if (content.includes("Mandatory Behaviors")) markers.push("MANDATORY_BEHAVIORS");
  if (content.includes("Agent Quick Reference")) markers.push("AGENT_QUICK_REFERENCE");
  if (content.includes("Hatch3r Bridge") || content.includes("Hatch3r Project Instructions")) markers.push("BRIDGE_SECTION");
  if (content.includes("mcpServers")) markers.push("MCP_CONFIG");
  if (content.includes("permissions")) markers.push("PERMISSIONS_CONFIG");
  if (content.includes("Agent Teams")) markers.push("AGENT_TEAMS");
  if (content.includes("alwaysApply:")) markers.push("CURSOR_ALWAYS_APPLY");
  if (content.includes("globs:")) markers.push("CURSOR_GLOBS");

  // JSON detection
  try {
    JSON.parse(content);
    markers.push("VALID_JSON");
  } catch (err) {
    // Not JSON — that's an expected branch (markers simply don't gain VALID_JSON).
    void err;
  }

  return markers.sort();
}

function makeManifest(tool: string, overrides: Partial<Parameters<typeof createManifest>[0]> = {}): HatchManifest {
  const { features, ...createOpts } = overrides;
  return createManifest({
    tools: [tool as "cursor"],
    mcpServers: ["github"],
    // W3-mcp-optin: DEFAULT_FEATURES.mcp is now false (opt-in). The snapshots
    // were captured with MCP output included, so pin the feature on; per-call
    // feature overrides still win via the merge.
    features: { mcp: true, ...features },
    ...createOpts,
  });
}

describe("adapter output snapshots", () => {
  describe("CursorAdapter", () => {
    const adapter = new CursorAdapter();

    it("output structure matches snapshot", async () => {
      const manifest = makeManifest("cursor");
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const normalized = normalizeOutputs(outputs);

      expect(normalized).toMatchSnapshot();
    });

    it("file paths match snapshot", async () => {
      const manifest = makeManifest("cursor");
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const paths = outputs.map((o) => o.path).sort();

      expect(paths).toMatchSnapshot();
    });
  });

  describe("ClaudeAdapter", () => {
    const adapter = new ClaudeAdapter();

    it("output structure matches snapshot", async () => {
      const manifest = makeManifest("claude");
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const normalized = normalizeOutputs(outputs);

      expect(normalized).toMatchSnapshot();
    });

    it("file paths match snapshot", async () => {
      const manifest = makeManifest("claude");
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const paths = outputs.map((o) => o.path).sort();

      expect(paths).toMatchSnapshot();
    });
  });

  describe("CopilotAdapter", () => {
    const adapter = new CopilotAdapter();

    it("output structure matches snapshot", async () => {
      const manifest = makeManifest("copilot");
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const normalized = normalizeOutputs(outputs);

      expect(normalized).toMatchSnapshot();
    });

    it("file paths match snapshot", async () => {
      const manifest = makeManifest("copilot");
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const paths = outputs.map((o) => o.path).sort();

      expect(paths).toMatchSnapshot();
    });
  });
});
