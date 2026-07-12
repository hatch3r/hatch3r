import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cycle 12 Wave 4 / Finding D3-SA3.3-09: parse-level + structural contract for
 * `.cursor-plugin/plugin.json`, hatch3r's Cursor-marketplace plugin manifest.
 *
 * Before this test the Cursor manifest had no JSON-syntax or structural gate:
 * its only automated coverage was the raw-text count-drift probes in
 * `scripts/inventory.ts` (e.g. `/(\d+)\s+agents/`), which regex the bytes and
 * would pass a manifest broken by a trailing comma or truncation — the break
 * surfaced only at Cursor-marketplace upload time. This test moves detection to
 * every CI run: `JSON.parse` catches syntax breaks, and the field assertions pin
 * the required metadata and component-path values.
 *
 * Scope boundary (from the finding's bias_check): version parity with
 * package.json is deliberately NOT asserted. The Cursor plugin cadence may
 * diverge from the npm package (`.claude/skills/h4tcher-release-prep/SKILL.md`:
 * "Cursor plugin cadence can diverge; bump only if the plugin changes"), so this
 * suite gates syntax + structure only, not version equality.
 *
 * Pillar service:
 *   - content-quality.CQ5 (Testability): adds a parse + structural test class
 *     the manifest previously lacked.
 *   - P3 (Adapter & External Tool Currency): the manifest's component-path fields
 *     stay pinned to the canonical content directories.
 *   - P5 (Governance Self-Quality): a Cursor-marketplace listing broken by a JSON
 *     edit fails CI here instead of shipping.
 *
 * Cross-references:
 *   - `src/__tests__/manifests/claude-plugin.test.ts` — sibling structural test
 *     for the Anthropic Claude Code manifest; mirrors the JSON.parse + field
 *     conventions used here.
 *   - `scripts/inventory.ts` — count-drift probes for this same file (raw-text
 *     regex; complementary to, not a substitute for, this parse-level gate).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = join(ROOT, ".cursor-plugin", "plugin.json");

interface CursorPluginManifest {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  rules?: string;
  skills?: string;
  agents?: string;
  commands?: string;
  hooks?: string;
  mcp?: string;
}

async function loadManifest(): Promise<CursorPluginManifest> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as CursorPluginManifest;
}

describe(".cursor-plugin/plugin.json", () => {
  describe("JSON syntax", () => {
    it("parses as valid JSON", async () => {
      const raw = await readFile(MANIFEST_PATH, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("required metadata fields", () => {
    it("declares a kebab-case name", async () => {
      const m = await loadManifest();
      expect(m.name).toBe("hatch3r");
      expect(m.name).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it("declares a non-empty displayName", async () => {
      const m = await loadManifest();
      expect(m.displayName).toBe("Hatch3r");
    });

    it("declares an OSI license identifier", async () => {
      const m = await loadManifest();
      expect(m.license).toBe("MIT");
    });

    it("declares repository pointing at the canonical GitHub repo", async () => {
      const m = await loadManifest();
      expect(m.repository).toBe("https://github.com/hatch3r/hatch3r");
    });
  });

  describe("version (structure only — no package.json parity)", () => {
    it("declares a semver-shaped version", async () => {
      const m = await loadManifest();
      // Structural shape check only. Parity with package.json is intentionally
      // NOT asserted: the Cursor plugin cadence may diverge from the npm package
      // (see the release-prep skill's independent-cadence note).
      expect(typeof m.version).toBe("string");
      expect(m.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    });
  });

  describe("component path fields", () => {
    it("points rules at the canonical directory", async () => {
      const m = await loadManifest();
      expect(m.rules).toBe("rules/");
    });

    it("points skills at the canonical directory", async () => {
      const m = await loadManifest();
      expect(m.skills).toBe("skills/");
    });

    it("points agents at the canonical directory", async () => {
      const m = await loadManifest();
      expect(m.agents).toBe("agents/");
    });

    it("points commands at the canonical directory", async () => {
      const m = await loadManifest();
      expect(m.commands).toBe("commands/");
    });

    it("points hooks at the canonical directory", async () => {
      const m = await loadManifest();
      expect(m.hooks).toBe("hooks/");
    });

    it("points mcp at the repo-root MCP config", async () => {
      const m = await loadManifest();
      expect(m.mcp).toBe("mcp/mcp.json");
    });
  });

  describe("description", () => {
    it("provides a description without anti-slop wordlist hits", async () => {
      const m = await loadManifest();
      expect(typeof m.description).toBe("string");
      expect(m.description!.length).toBeGreaterThan(20);
      // Anti-slop spot check (CLAUDE.md anti-slop wordlist; the description
      // ships in the Cursor marketplace listing, so banned phrases would
      // surface user-side). Mirrors the claude-plugin sibling test.
      const banned = [
        /\bbest possible\b/i,
        /\bbest-in-class\b/i,
        /\bworld-class\b/i,
        /\bcomprehensive and thorough\b/i,
        /\bexhaustive\b/i,
        /\brobust and resilient\b/i,
        /\bhigh-quality\b/i,
      ];
      for (const re of banned) {
        expect(m.description).not.toMatch(re);
      }
    });
  });
});
