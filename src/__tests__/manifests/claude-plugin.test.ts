import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cycle 9 Wave 2 / Finding C9-H73 (D18-F18.2.2): structural contract for
 * `.claude-plugin/plugin.json`, hatch3r's Anthropic Claude Code plugin
 * manifest. The audit-finding text says "manifest.json"; the Anthropic plugin
 * spec calls the file `plugin.json`
 * (`https://code.claude.com/docs/en/plugins-reference` "Plugin manifest
 * schema"), and Claude Code reads only that filename. This test pins the
 * manifest to the spec-canonical filename, the required + recommended
 * metadata fields, and the `trust_model_ref` extension that points the
 * marketplace reviewer at `governance/pack-trust-model.md` (authored by
 * C9-H52).
 *
 * Pillar service:
 *   - P3 (Adapter & External Tool Currency): manifest matches the latest
 *     documented Anthropic plugin spec captured 2026-05-18.
 *   - P5 (Governance Self-Quality): manifest counts match the canonical
 *     inventory and reference the pack-trust-model artifact, so a drift
 *     between the trust contract and the marketplace listing fails this
 *     test rather than ship.
 *   - P6 (Security & Trust Governance): `trust_model_ref` is a first-class
 *     manifest field reviewable before install.
 *
 * Cross-references:
 *   - `governance/pack-trust-model.md` — the trust contract surfaced by
 *     `trust_model_ref`.
 *   - `.cursor-plugin/plugin.json` — separate Cursor-marketplace manifest;
 *     the inventory drift probes in `scripts/inventory.ts` cover that file.
 *   - `package.json` — `version` source of truth (matched here).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = join(ROOT, ".claude-plugin", "plugin.json");

interface ClaudePluginManifest {
  $schema?: string;
  name: string;
  version?: string;
  description?: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  skills?: string;
  agents?: string;
  commands?: string;
  hooks?: string;
  mcpServers?: string;
  trust_model_ref?: string;
}

async function loadManifest(): Promise<ClaudePluginManifest> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as ClaudePluginManifest;
}

async function loadPackageJson(): Promise<{ version: string }> {
  const raw = await readFile(join(ROOT, "package.json"), "utf8");
  return JSON.parse(raw) as { version: string };
}

describe(".claude-plugin/plugin.json", () => {
  describe("JSON syntax", () => {
    it("parses as valid JSON", async () => {
      const raw = await readFile(MANIFEST_PATH, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("required field (Anthropic plugin spec)", () => {
    it("declares a kebab-case name", async () => {
      const m = await loadManifest();
      expect(m.name).toBe("hatch3r");
      // Anthropic spec: unique identifier (kebab-case, no spaces).
      expect(m.name).toMatch(/^[a-z][a-z0-9-]*$/);
    });
  });

  describe("metadata fields", () => {
    it("declares $schema for editor autocomplete", async () => {
      const m = await loadManifest();
      expect(m.$schema).toBe(
        "https://json.schemastore.org/claude-code-plugin-manifest.json",
      );
    });

    it("pins version to the package.json version", async () => {
      const m = await loadManifest();
      const pkg = await loadPackageJson();
      expect(m.version).toBe(pkg.version);
      // semver shape (basic).
      expect(m.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    });

    it("provides a description without anti-slop wordlist hits", async () => {
      const m = await loadManifest();
      expect(typeof m.description).toBe("string");
      expect(m.description!.length).toBeGreaterThan(20);
      // Anti-slop spot check (CLAUDE.md anti-slop wordlist; description
      // ships in the marketplace listing, so banned phrases would surface
      // user-side).
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

    it("declares author with name + contact email", async () => {
      const m = await loadManifest();
      expect(m.author).toBeDefined();
      expect(m.author!.name).toBe("hatch3r");
      expect(m.author!.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    });

    it("declares homepage as an https URL", async () => {
      const m = await loadManifest();
      expect(m.homepage).toMatch(/^https:\/\//);
    });

    it("declares repository pointing at the canonical GitHub repo", async () => {
      const m = await loadManifest();
      expect(m.repository).toBe("https://github.com/hatch3r/hatch3r");
    });

    it("declares an OSI license identifier", async () => {
      const m = await loadManifest();
      expect(m.license).toBe("MIT");
    });

    it("ships discovery keywords including 'claude-code'", async () => {
      const m = await loadManifest();
      expect(Array.isArray(m.keywords)).toBe(true);
      expect(m.keywords).toContain("claude-code");
      expect(m.keywords!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("component path fields", () => {
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

    it("declares mcpServers at the repo-root MCP config", async () => {
      const m = await loadManifest();
      expect(m.mcpServers).toBe(".mcp.json");
    });
  });

  describe("trust_model_ref (C9-H73)", () => {
    it("references governance/pack-trust-model.md", async () => {
      const m = await loadManifest();
      expect(m.trust_model_ref).toBe("governance/pack-trust-model.md");
    });

    it("points at a file that exists in the repo", async () => {
      const m = await loadManifest();
      const target = join(ROOT, m.trust_model_ref!);
      // readFile throws if the file is missing; assert success.
      const body = await readFile(target, "utf8");
      expect(body.length).toBeGreaterThan(0);
      // Spot-check that the target is the trust model, not a redirect.
      expect(body).toMatch(/Pack Trust Model/i);
    });
  });

  describe("unknown-field hygiene", () => {
    it("only emits fields documented in the Anthropic plugin spec or the trust_model_ref extension", async () => {
      const m = await loadManifest();
      // Plugin manifest schema field set documented at
      // https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema
      // plus the local `trust_model_ref` extension that surfaces the C9-H52
      // trust contract.
      const allowed = new Set([
        "$schema",
        "name",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "skills",
        "commands",
        "agents",
        "hooks",
        "mcpServers",
        "outputStyles",
        "lspServers",
        "experimental",
        "userConfig",
        "channels",
        "dependencies",
        "trust_model_ref",
      ]);
      for (const key of Object.keys(m)) {
        expect(allowed.has(key)).toBe(true);
      }
    });
  });
});
