// Bucket 2.5 / Decision 21 — D09 capability-utilization audit-logic tests.
//
// Exercises every export from src/adapters/capabilityMatrix.ts:
//   enumerateAdapterCapabilities       — happy + invalid-adapter
//   enumeratePlatformCapabilities      — doc present, doc missing (ENOENT),
//                                        doc schema-drift, env-var override
//   computeUtilization                  — full mismatch, partial coverage,
//                                        adapter mismatch error, ratio bounds
//   surfaceFindings                     — Medium for high-leverage, Info for
//                                        low-leverage, no findings for fully
//                                        utilized report, rigor-contract schema
//
// Reads HATCH3R_CAPABILITY_MATRIX_DOC env var to redirect doc reads to a
// temp file; restores the env var after each test that mutates it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  enumerateAdapterCapabilities,
  enumeratePlatformCapabilities,
  computeUtilization,
  surfaceFindings,
  type AdapterCapabilities,
  type PlatformCapabilities,
  type UtilizationReport,
} from "../../adapters/capabilityMatrix.js";

const ENV_KEY = "HATCH3R_CAPABILITY_MATRIX_DOC";

describe("capabilityMatrix", () => {
  let savedEnv: string | undefined;
  let tempDir: string | null = null;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
  });

  afterEach(async () => {
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  // ── enumerateAdapterCapabilities ──────────────────────────────────────────

  describe("enumerateAdapterCapabilities", () => {
    it("returns declared row for claude with every expected key as boolean", () => {
      const row = enumerateAdapterCapabilities("claude");
      expect(row.adapter).toBe("claude");
      // Sanity-check several known-true and known-false keys.
      expect(row.declared.agents).toBe(true);
      expect(row.declared.skills).toBe(true);
      expect(row.declared.hooks).toBe(true);
      expect(row.declared.nativeQuestionTool).toBe(true);
      expect(row.declared.githubAgents).toBe(false);
      // Every declared value is a boolean (no `undefined` leak).
      for (const v of Object.values(row.declared)) {
        expect(typeof v).toBe("boolean");
      }
    });

    it("returns declared row for cursor", () => {
      const row = enumerateAdapterCapabilities("cursor");
      expect(row.adapter).toBe("cursor");
      expect(row.declared.rules).toBe(true);
      expect(row.declared.nativeQuestionTool).toBe(false); // Cursor lacks native question tool
      expect(row.declared.prompts).toBe(false); // Cursor has no .prompts/ surface
    });

    it("returns declared row for copilot with hooks=false (no hook surface, #73)", () => {
      const row = enumerateAdapterCapabilities("copilot");
      expect(row.adapter).toBe("copilot");
      expect(row.declared.hooks).toBe(false);
      // D9-H-5 (D9, P4): copilot.prompts retracted to false — hatch3r ships no
      // canonical prompts/ content, so the adapter emits no prompts source.
      expect(row.declared.prompts).toBe(false);
      expect(row.declared.githubAgents).toBe(true);
    });

    it("returns the skills-only declared row for codex", () => {
      const row = enumerateAdapterCapabilities("codex");
      expect(row.adapter).toBe("codex");
      expect(row.declared.skills).toBe(true);
      expect(row.declared.agents).toBe(false);
      expect(row.declared.commands).toBe(false);
    });

    it("throws on unknown adapter", () => {
      // @ts-expect-error — intentional invalid input to verify guard
      expect(() => enumerateAdapterCapabilities("aider")).toThrow(/unknown adapter/);
    });
  });

  // ── enumeratePlatformCapabilities ─────────────────────────────────────────

  describe("enumeratePlatformCapabilities", () => {
    it("returns default seed with ENOENT warning when doc missing", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      // Point at a non-existent file inside the temp dir.
      process.env[ENV_KEY] = join(tempDir, "no-such-file.md");

      const plat = await enumeratePlatformCapabilities("claude");
      expect(plat.adapter).toBe("claude");
      expect(plat.source).toBe("default");
      expect(plat.capabilities.length).toBeGreaterThan(0);
      expect(plat.warnings.some((w) => /not found/.test(w))).toBe(true);
    });

    it("flags source as 'doc' when reference doc parses cleanly", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      const docPath = join(tempDir, "matrix.md");
      // Synthetic doc with the header sentinel + the per-adapter marker the
      // light-touch parser expects.
      await writeFile(
        docPath,
        "# Adapter Capability Matrix\n\nLegend ...\n\n**cursor** | Y | Y |\n",
        "utf-8",
      );
      process.env[ENV_KEY] = docPath;

      const plat = await enumeratePlatformCapabilities("cursor");
      expect(plat.source).toBe("doc");
      expect(plat.warnings).toEqual([]);
      // Seed list is the authoritative payload regardless of doc source.
      expect(plat.capabilities.find((c) => c.id === "rules")).toBeDefined();
    });

    it("warns on schema-drift but still returns seed", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      const docPath = join(tempDir, "drifted.md");
      // Doc with the header but no per-adapter marker for `claude`.
      await writeFile(docPath, "# Adapter Capability Matrix\n\nNo adapter markers here.\n", "utf-8");
      process.env[ENV_KEY] = docPath;

      const plat = await enumeratePlatformCapabilities("claude");
      expect(plat.source).toBe("default");
      expect(plat.warnings.some((w) => /did not match expected schema/.test(w))).toBe(true);
      expect(plat.capabilities.length).toBeGreaterThan(0);
    });

    it("seed for copilot marks hooks as partial (VS Code Preview PreToolUse, #73)", async () => {
      // D9-17 / D9-20 (Cycle 11): VS Code documents a Preview PreToolUse deny
      // hook, so the seed status is `partial` (Preview, VS-Code-only, not GA),
      // no longer the absolute `unsupported`. hatch3r still emits no copilot
      // hook (ADAPTER_CAPABILITIES.copilot.hooks=false), so computeUtilization
      // classifies the row `unutilized` — the enhancement-surface signal.
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      process.env[ENV_KEY] = join(tempDir, "absent.md");
      const plat = await enumeratePlatformCapabilities("copilot");
      const hooks = plat.capabilities.find((c) => c.id === "hooks");
      expect(hooks).toBeDefined();
      expect(hooks!.status).toBe("partial");
    });

    it("seed for copilot includes a handoffs row (D9-18)", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      process.env[ENV_KEY] = join(tempDir, "absent.md");
      const plat = await enumeratePlatformCapabilities("copilot");
      const handoffs = plat.capabilities.find((c) => c.id === "handoffs");
      expect(handoffs).toBeDefined();
      expect(handoffs!.status).toBe("supported");
    });

    it("seed for cursor exposes preToolUse + subagentStart hook rows (D9-20)", async () => {
      // Cursor now documents preToolUse + subagentStart hooks AND hatch3r emits
      // both (.cursor/hooks.json) — the prior single `unsupported` hooks row was
      // stale. Both map to the `hooks` declared flag (true for cursor).
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      process.env[ENV_KEY] = join(tempDir, "absent.md");
      const plat = await enumeratePlatformCapabilities("cursor");
      const pre = plat.capabilities.find((c) => c.id === "pre-tool-use");
      const sub = plat.capabilities.find((c) => c.id === "subagent-start");
      expect(pre?.status).toBe("supported");
      expect(sub?.status).toBe("supported");
      // The stale `unsupported` single-hooks row must be gone.
      expect(plat.capabilities.find((c) => c.id === "hooks")).toBeUndefined();
    });

    it("seed for codex records its repository skill surface", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-capmatrix-"));
      process.env[ENV_KEY] = join(tempDir, "absent.md");
      const plat = await enumeratePlatformCapabilities("codex");
      expect(plat.capabilities).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "skills", status: "supported" })]),
      );
    });
  });

  // ── computeUtilization ────────────────────────────────────────────────────

  describe("computeUtilization", () => {
    it("ratio is 1.0 when every supportable capability is declared", () => {
      const declared: AdapterCapabilities = {
        adapter: "claude",
        declared: {
          agents: true,
          skills: true,
          rules: true,
          hooks: true,
          mcp: true,
          commands: true,
          prompts: false,
          githubAgents: false,
          worktree: true,
          customization: true,
          modelOverride: true,
          nativeQuestionTool: true,
          cliTools: true,
        },
      };
      const platform: PlatformCapabilities = {
        adapter: "claude",
        capabilities: [
          { id: "hooks", name: "Hooks", status: "supported" },
          { id: "mcp-servers", name: "MCP", status: "supported" },
          { id: "skills", name: "Skills", status: "supported" },
        ],
        source: "default",
        warnings: [],
      };
      const report = computeUtilization("claude", declared, platform);
      expect(report.utilization_ratio).toBe(1);
      for (const row of report.rows) {
        expect(row.utilization).toBe("utilized");
      }
    });

    it("ratio reflects partial-utilization weighting (0.5 per partial)", () => {
      const declared: AdapterCapabilities = {
        adapter: "cursor",
        declared: { rules: true, hooks: false }, // intentionally sparse — others default-false in lookup
      };
      const platform: PlatformCapabilities = {
        adapter: "cursor",
        capabilities: [
          { id: "rules", name: "Rules", status: "supported" }, // utilized => 1.0
          { id: "hooks", name: "Hooks", status: "supported" }, // unutilized => 0
          { id: "plugin-system", name: "Plugins", status: "partial" }, // unutilized => 0
        ],
        source: "default",
        warnings: [],
      };
      const report = computeUtilization("cursor", declared, platform);
      // 1.0 + 0 + 0 = 1.0 covered / 3 total = 0.333...
      expect(report.utilization_ratio).toBeCloseTo(1 / 3, 5);
    });

    it("marks platformStatus='unsupported' rows as 'n/a' and excludes from denominator", () => {
      const declared: AdapterCapabilities = {
        adapter: "copilot",
        declared: { rules: true },
      };
      const platform: PlatformCapabilities = {
        adapter: "copilot",
        capabilities: [
          { id: "copilot-instructions", name: "Instructions", status: "supported" }, // utilized via rules
          { id: "hooks", name: "Hooks", status: "unsupported" }, // n/a, excluded
        ],
        source: "default",
        warnings: [],
      };
      const report = computeUtilization("copilot", declared, platform);
      expect(report.rows[1].utilization).toBe("n/a");
      // Denominator: 1 supportable row (copilot-instructions), covered = 1.
      expect(report.utilization_ratio).toBe(1);
    });

    it("returns ratio=1 when zero supportable rows (vacuous coverage)", () => {
      const declared: AdapterCapabilities = { adapter: "copilot", declared: {} };
      const platform: PlatformCapabilities = {
        adapter: "copilot",
        capabilities: [{ id: "hooks", name: "Hooks", status: "unsupported" }],
        source: "default",
        warnings: [],
      };
      const report = computeUtilization("copilot", declared, platform);
      expect(report.utilization_ratio).toBe(1);
    });

    it("marks declared-true + platform-partial rows as partially-utilized", () => {
      const declared: AdapterCapabilities = {
        adapter: "cursor",
        declared: { worktree: true },
      };
      const platform: PlatformCapabilities = {
        adapter: "cursor",
        capabilities: [{ id: "worktree-workflows", name: "Worktree", status: "partial" }],
        source: "default",
        warnings: [],
      };
      const report = computeUtilization("cursor", declared, platform);
      expect(report.rows[0].utilization).toBe("partially-utilized");
      expect(report.utilization_ratio).toBe(0.5);
    });

    it("records null declaredKey for capabilities without a matrix column", () => {
      const declared: AdapterCapabilities = { adapter: "claude", declared: {} };
      const platform: PlatformCapabilities = {
        adapter: "claude",
        capabilities: [{ id: "agent-teams", name: "Agent Teams", status: "supported" }],
        source: "default",
        warnings: [],
      };
      const report = computeUtilization("claude", declared, platform);
      expect(report.rows[0].declaredKey).toBeNull();
      expect(report.rows[0].declaredSupport).toBe(false);
      expect(report.rows[0].utilization).toBe("unutilized");
    });

    it("throws on adapter mismatch between declared and platform args", () => {
      const declared: AdapterCapabilities = { adapter: "claude", declared: {} };
      const platform: PlatformCapabilities = {
        adapter: "cursor",
        capabilities: [],
        source: "default",
        warnings: [],
      };
      expect(() => computeUtilization("claude", declared, platform)).toThrow(/adapter mismatch/);
    });
  });

  // ── surfaceFindings ───────────────────────────────────────────────────────

  describe("surfaceFindings", () => {
    function buildReport(rows: UtilizationReport["rows"]): UtilizationReport {
      return { adapter: "claude", rows, utilization_ratio: 0.5 };
    }

    it("emits no findings when every row is utilized or n/a", () => {
      const report = buildReport([
        {
          capabilityId: "hooks",
          capabilityName: "Hooks",
          platformStatus: "supported",
          declaredKey: "hooks",
          declaredSupport: true,
          utilization: "utilized",
        },
        {
          capabilityId: "plugin-system",
          capabilityName: "Plugin",
          platformStatus: "unsupported",
          declaredKey: null,
          declaredSupport: false,
          utilization: "n/a",
        },
      ]);
      expect(surfaceFindings(report)).toEqual([]);
    });

    it("emits Medium severity for high-leverage unutilized capabilities", () => {
      const report = buildReport([
        {
          capabilityId: "hooks",
          capabilityName: "Hooks",
          platformStatus: "supported",
          declaredKey: "hooks",
          declaredSupport: false,
          utilization: "unutilized",
        },
      ]);
      const findings = surfaceFindings(report);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("Medium");
      expect(findings[0].id).toBe("D9-CAPUTIL-claude-hooks");
      expect(findings[0].progress_toward_pillar).toBe("governance.P3+0.10");
      expect(findings[0].impact_horizon).toBe("medium");
    });

    it("emits Info severity for low-leverage capabilities", () => {
      const report = buildReport([
        {
          capabilityId: "indexing",
          capabilityName: "Indexing",
          platformStatus: "supported",
          declaredKey: null,
          declaredSupport: false,
          utilization: "unutilized",
        },
      ]);
      const findings = surfaceFindings(report);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("Info");
      expect(findings[0].progress_toward_pillar).toBe("content-quality.CQ9+0.05");
      expect(findings[0].impact_horizon).toBe("long");
    });

    it("emits a finding for partially-utilized rows", () => {
      const report = buildReport([
        {
          capabilityId: "worktree-workflows",
          capabilityName: "Worktree",
          platformStatus: "partial",
          declaredKey: "worktree",
          declaredSupport: true,
          utilization: "partially-utilized",
        },
      ]);
      const findings = surfaceFindings(report);
      expect(findings).toHaveLength(1);
      // Confidence downgrades to medium when the underlying platform status is partial.
      expect(findings[0].confidence).toBe("medium");
      expect(findings[0].body).toContain("partially-covered");
    });

    it("every finding satisfies the Required Finding Output Schema", () => {
      const report = buildReport([
        {
          capabilityId: "hooks",
          capabilityName: "Hooks",
          platformStatus: "supported",
          declaredKey: "hooks",
          declaredSupport: false,
          utilization: "unutilized",
        },
      ]);
      const finding = surfaceFindings(report)[0];

      // Schema keys.
      expect(finding.confidence).toMatch(/^(high|medium|low)$/);
      expect(finding.confidence_basis.length).toBeGreaterThan(10);
      expect(finding.falsifiability).toMatch(/grep/);
      expect(finding.causal_chain.split("→").length).toBeGreaterThanOrEqual(3);
      expect(finding.bias_check).toMatch(/bias/i);
      expect(finding.counter_argument.length).toBeGreaterThan(10);
      expect(finding.sources.length).toBeGreaterThanOrEqual(2);
      for (const src of finding.sources) {
        expect(src.url).toMatch(/^https:\/\//);
        expect(src.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(src.trust_tier).toBe("official-docs");
      }
      expect(finding.impact_horizon).toMatch(/^(short|medium|long)$/);
      expect(finding.progress_toward_pillar).toMatch(/^(governance|content-quality)\.\w+\+\d/);
    });

    it("body explicitly references the adapter source file for actionable triage", () => {
      const report = buildReport([
        {
          capabilityId: "hooks",
          capabilityName: "Hooks",
          platformStatus: "supported",
          declaredKey: "hooks",
          declaredSupport: false,
          utilization: "unutilized",
        },
      ]);
      const finding = surfaceFindings(report)[0];
      expect(finding.body).toContain("src/adapters/claude.ts");
    });
  });
});
