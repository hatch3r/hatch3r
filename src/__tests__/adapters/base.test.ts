import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { BaseAdapter, output, KNOWN_COMPANION_SUBDIRS } from "../../adapters/base.js";
import type { AdapterContext } from "../../adapters/base.js";
import { buildSelectionAllowlist, classifySelection } from "../../content/index.js";
import type { AdapterOutput, ContentSelection, HatchManifest } from "../../types.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { PLATFORM_TOOL_MARKER } from "../../pipeline/adapterToolTranslator.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

// Concrete subclass that throws in doGenerate
class ThrowingAdapter extends BaseAdapter {
  readonly name = "throwing";

  constructor(private readonly error: Error) {
    super();
  }

  protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
    throw this.error;
  }
}

// Concrete subclass that pushes warnings before throwing
class WarningThenThrowAdapter extends BaseAdapter {
  readonly name = "warning-then-throw";

  constructor(
    private readonly preWarnings: string[],
    private readonly error: Error,
  ) {
    super();
  }

  protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
    // Simulate warnings added during generation (e.g. from inlineRules/readFilteredMcp)
    this.warnings.push(...this.preWarnings);
    throw this.error;
  }
}

// Concrete subclass that succeeds and adds warnings
class SuccessAdapter extends BaseAdapter {
  readonly name = "success";

  constructor(private readonly preWarnings: string[] = []) {
    super();
  }

  protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
    this.warnings.push(...this.preWarnings);
    return [output("test.md", "# Test content")];
  }
}

function makeManifest(
  overrides: Partial<Parameters<typeof createManifest>[0]> = {},
): HatchManifest {
  return createManifest({
    tools: ["claude"],
    ...overrides,
  });
}

describe("BaseAdapter", () => {
  describe("output() helper", () => {
    it("creates an AdapterOutput with action 'create'", () => {
      const result = output("path.md", "content", "managed");
      expect(result).toEqual({
        path: "path.md",
        content: "content",
        managedContent: "managed",
        action: "create",
      });
    });

    it("sets managedContent to undefined when not provided", () => {
      const result = output("path.md", "content");
      expect(result.managedContent).toBeUndefined();
    });
  });

  describe("generate()", () => {
    it("resets warnings array on each call", async () => {
      const adapter = new SuccessAdapter(["warning-1"]);
      const manifest = makeManifest();

      await adapter.generate(FIXTURES_DIR, manifest);
      // SA12.1-F-D12-M5: BaseAdapter appends a tracking-gap warning when an
      // adapter emits outputs without ever reading canonical files (this
      // SuccessAdapter never does), so the assertion drops the M5 line and
      // checks only that "warning-1" survives.
      expect(adapter.warnings.filter((w) => !w.includes("canonical-source tracking"))).toEqual([
        "warning-1",
      ]);

      // Second call should reset warnings
      await adapter.generate(FIXTURES_DIR, manifest);
      expect(adapter.warnings.filter((w) => !w.includes("canonical-source tracking"))).toEqual([
        "warning-1",
      ]);
      // Should NOT have accumulated ["warning-1", "warning-1"]
      expect(adapter.warnings.filter((w) => w === "warning-1").length).toBe(1);
    });
  });

  describe("error propagation from doGenerate", () => {
    it("propagates errors thrown in doGenerate", async () => {
      const error = new Error("generation failed");
      const adapter = new ThrowingAdapter(error);
      const manifest = makeManifest();

      await expect(adapter.generate(FIXTURES_DIR, manifest)).rejects.toThrow(
        "generation failed",
      );
    });

    it("propagates the exact error instance from doGenerate", async () => {
      const error = new Error("specific error");
      const adapter = new ThrowingAdapter(error);
      const manifest = makeManifest();

      await expect(adapter.generate(FIXTURES_DIR, manifest)).rejects.toBe(error);
    });

    it("retains pre-error warnings when doGenerate throws", async () => {
      const preWarnings = ["mcp config missing field", "rule deprecated"];
      const error = new Error("generation failed after warnings");
      const adapter = new WarningThenThrowAdapter(preWarnings, error);
      const manifest = makeManifest();

      await expect(adapter.generate(FIXTURES_DIR, manifest)).rejects.toThrow();

      // Warnings added before the error should still be present on the adapter
      expect(adapter.warnings).toContain("mcp config missing field");
      expect(adapter.warnings).toContain("rule deprecated");
      expect(adapter.warnings.length).toBe(2);
    });

    it("warnings array is reset before doGenerate runs (no stale warnings)", async () => {
      const adapter = new WarningThenThrowAdapter(
        ["first-run-warning"],
        new Error("fail"),
      );
      const manifest = makeManifest();

      // First call — fails with warning
      await expect(adapter.generate(FIXTURES_DIR, manifest)).rejects.toThrow();
      expect(adapter.warnings).toEqual(["first-run-warning"]);

      // Second call — warnings should be reset to only the new run's warnings
      const adapter2 = new WarningThenThrowAdapter(
        ["second-run-warning"],
        new Error("fail again"),
      );
      await expect(adapter2.generate(FIXTURES_DIR, manifest)).rejects.toThrow();
      expect(adapter2.warnings).toEqual(["second-run-warning"]);
    });
  });

  describe("getOutputPaths()", () => {
    it("returns paths from generate() output", async () => {
      const adapter = new SuccessAdapter();
      const manifest = makeManifest();

      const paths = await adapter.getOutputPaths(FIXTURES_DIR, manifest);
      expect(paths).toEqual(["test.md"]);
    });
  });

  // ── Finding 3.10: generationMode "minimal" ──────────────────────
  describe("generationMode minimal", () => {
    it("defaults to 'standard' when no generationMode is passed", async () => {
      let capturedMode: string | undefined;
      class ModeCapture extends BaseAdapter {
        readonly name = "mode-capture";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          capturedMode = ctx.generationMode;
          return [output("test.md", "content")];
        }
      }
      const adapter = new ModeCapture();
      const manifest = makeManifest();
      await adapter.generate(FIXTURES_DIR, manifest);
      expect(capturedMode).toBe("standard");
    });

    it("passes 'minimal' to doGenerate when specified", async () => {
      let capturedMode: string | undefined;
      class ModeCapture extends BaseAdapter {
        readonly name = "mode-capture";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          capturedMode = ctx.generationMode;
          return [output("test.md", "content")];
        }
      }
      const adapter = new ModeCapture();
      const manifest = makeManifest();
      await adapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");
      expect(capturedMode).toBe("minimal");
    });

    it("isMinimal returns true for minimal mode", async () => {
      let isMin = false;
      class MinimalCheck extends BaseAdapter {
        readonly name = "minimal-check";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          isMin = this.isMinimal(ctx);
          return [output("test.md", "content")];
        }
      }
      const adapter = new MinimalCheck();
      const manifest = makeManifest();
      await adapter.generate(FIXTURES_DIR, manifest, undefined, "minimal");
      expect(isMin).toBe(true);
    });

    it("isMinimal returns false for standard mode", async () => {
      let isMin = true;
      class MinimalCheck extends BaseAdapter {
        readonly name = "minimal-check";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          isMin = this.isMinimal(ctx);
          return [output("test.md", "content")];
        }
      }
      const adapter = new MinimalCheck();
      const manifest = makeManifest();
      await adapter.generate(FIXTURES_DIR, manifest, undefined, "standard");
      expect(isMin).toBe(false);
    });

    it("stripMinimal removes HTML comments", async () => {
      let stripped = "";
      class StripCheck extends BaseAdapter {
        readonly name = "strip-check";
        protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
          stripped = this.stripMinimal("before <!-- comment --> after");
          return [output("test.md", "content")];
        }
      }
      const adapter = new StripCheck();
      await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(stripped).not.toContain("<!-- comment -->");
      expect(stripped).toContain("before");
      expect(stripped).toContain("after");
    });

    it("stripMinimal removes horizontal rules", async () => {
      let stripped = "";
      class StripCheck extends BaseAdapter {
        readonly name = "strip-check";
        protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
          stripped = this.stripMinimal("line1\n---\nline2\n***\nline3");
          return [output("test.md", "content")];
        }
      }
      const adapter = new StripCheck();
      await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(stripped).not.toMatch(/^[-*_]{3,}$/m);
      expect(stripped).toContain("line1");
      expect(stripped).toContain("line2");
      expect(stripped).toContain("line3");
    });

    it("stripMinimal collapses 3+ blank lines to one", async () => {
      let stripped = "";
      class StripCheck extends BaseAdapter {
        readonly name = "strip-check";
        protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
          stripped = this.stripMinimal("a\n\n\n\n\nb");
          return [output("test.md", "content")];
        }
      }
      const adapter = new StripCheck();
      await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(stripped).toBe("a\n\nb");
    });
  });

  // ── C8-D12-M3: Per-output sourceFiles provenance ──────────────────
  describe("sourceFiles provenance", () => {
    it("populates sourceFiles on outputs when inlineRules reads canonical files", async () => {
      class RulesAdapter extends BaseAdapter {
        readonly name = "rules-only";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          const lines = await this.inlineRules(ctx);
          return [output("rules-out.md", lines.join("\n") || "empty")];
        }
      }
      const adapter = new RulesAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outputs.length).toBe(1);
      // Rules fixture directory contains scoped-rule.md and test-rule.md; the
      // inlineRules helper goes through readTrackedCanonicalFiles so both
      // absolute sourcePaths should appear on the output.
      expect(outputs[0]?.sourceFiles).toBeDefined();
      expect(outputs[0]?.sourceFiles?.length).toBeGreaterThan(0);
      expect(outputs[0]?.sourceFiles?.some((s) => s.endsWith("test-rule.md"))).toBe(true);
      expect(outputs[0]?.sourceFiles?.some((s) => s.endsWith("scoped-rule.md"))).toBe(true);
    });

    it("populates sourceFiles on outputs when inlineAgents reads canonical files", async () => {
      class AgentsAdapter extends BaseAdapter {
        readonly name = "agents-only";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          const lines = await this.inlineAgents(ctx);
          return [output("agents-out.md", lines.join("\n") || "empty")];
        }
      }
      const adapter = new AgentsAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outputs[0]?.sourceFiles?.some((s) => s.endsWith("test-agent.md"))).toBe(true);
    });

    it("populates sourceFiles for multi-helper adapters that aggregate rules + agents", async () => {
      class CombinedAdapter extends BaseAdapter {
        readonly name = "combined";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          const rules = await this.inlineRules(ctx);
          const agents = await this.inlineAgents(ctx);
          return [output("combined.md", [...rules, ...agents].join("\n") || "empty")];
        }
      }
      const adapter = new CombinedAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const sources = outputs[0]?.sourceFiles ?? [];
      // Adapter read both rules and agents dirs — both groups should show up
      // in the aggregate provenance list.
      expect(sources.some((s) => s.endsWith("test-rule.md"))).toBe(true);
      expect(sources.some((s) => s.endsWith("test-agent.md"))).toBe(true);
      // Deterministic sort: the returned array is monotonically ordered so
      // re-runs produce byte-identical `.provenance.json`.
      const sorted = [...sources].sort();
      expect(sources).toEqual(sorted);
    });

    it("attributes each per-file output to its single canonical source (D12-1)", async () => {
      // D12-1 (Cycle 11 Wave 2, D12, P2): per-FILE emission paths
      // (processCommandsRaw / processSkillsRaw) emit one output per canonical
      // file, each derived from exactly one source. Before D12-1 the base
      // class over-attributed every such output with the whole adapter-wide
      // read set; now each output's sourceFiles is the single file it came
      // from. The commands fixture has test-command.md; the skills fixture has
      // test-skill + the hatch3r-cli-* skills, so multiple per-file outputs
      // are emitted and each must carry its own one-element sourceFiles.
      class PerFileAdapter extends BaseAdapter {
        readonly name = "per-file";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          const commands = await this.processCommandsRaw(ctx, (id) => `cmd/${id}.md`);
          const skills = await this.processSkillsRaw(ctx, (id) => `skill/${id}.md`);
          return [...commands, ...skills];
        }
      }
      const adapter = new PerFileAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      // At least the test-command + test-skill outputs are present.
      expect(outputs.length).toBeGreaterThanOrEqual(2);
      const cmd = outputs.find((o) => o.path === "cmd/test-command.md");
      const skill = outputs.find((o) => o.path === "skill/test-skill.md");
      expect(cmd?.sourceFiles).toHaveLength(1);
      expect(cmd?.sourceFiles?.[0]).toMatch(/test-command\.md$/);
      expect(skill?.sourceFiles).toHaveLength(1);
      expect(skill?.sourceFiles?.[0]).toMatch(/test-skill[/\\]SKILL\.md$/);
      // Cross-attribution regression guard: the command output must NOT carry
      // the skill's source (the old shared-set behavior would have stamped
      // every read file onto every output).
      expect(cmd?.sourceFiles?.some((s) => /test-skill/.test(s))).toBe(false);
      // Each per-file output's source set is its own singleton, so distinct
      // per-file outputs do not share a sourceFiles array.
      expect(skill?.sourceFiles).not.toEqual(cmd?.sourceFiles);
    });

    it("fills the adapter-wide tracked set on aggregate outputs that do not self-attribute (C8-D12-M3)", async () => {
      // The broad-set fill is RESERVED for aggregate outputs (CLAUDE.md, the
      // Cursor bridge, copilot-instructions.md): an output that reads canonical
      // files via a helper but leaves sourceFiles unset still inherits the
      // whole tracked read set. Two such outputs share the identical set.
      class AggregateAdapter extends BaseAdapter {
        readonly name = "aggregate";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          await this.inlineRules(ctx); // reads rules into the tracked set
          // Neither output self-declares sourceFiles → both get the broad set.
          return [output("first.md", "first"), output("second.md", "second")];
        }
      }
      const adapter = new AggregateAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outputs.length).toBe(2);
      expect(outputs[0]?.sourceFiles?.length).toBeGreaterThan(0);
      // Both rules fixtures contributed; the aggregate output carries both.
      expect(outputs[0]?.sourceFiles?.some((s) => s.endsWith("test-rule.md"))).toBe(true);
      expect(outputs[0]?.sourceFiles?.some((s) => s.endsWith("scoped-rule.md"))).toBe(true);
      // Both aggregate outputs receive the identical adapter-wide set.
      expect(outputs[1]?.sourceFiles).toEqual(outputs[0]?.sourceFiles);
    });

    it("defaults sourceFiles to [] and warns when no canonical files are read (SA12.1-F-D12-M5)", async () => {
      class NoCanonicalAdapter extends BaseAdapter {
        readonly name = "no-canonical";
        protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
          return [output("config.json", JSON.stringify({ hello: "world" }))];
        }
      }
      const adapter = new NoCanonicalAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      // SA12.1-F-D12-M5 (Cycle 10 Wave 3, D12, P1): un-migrated adapters
      // previously left sourceFiles undefined which silently became `[]` in
      // .hatch3r/provenance.json — indistinguishable from a legitimate
      // config-only output. Now: BaseAdapter defaults to `[]` AND emits a
      // per-adapter warning so the tracking gap is visible at sync time.
      expect(outputs[0]?.sourceFiles).toEqual([]);
      expect(adapter.warnings.some((w) => w.includes("canonical-source tracking"))).toBe(true);
    });

    it("preserves sourceFiles when the adapter sets it explicitly", async () => {
      class ExplicitAdapter extends BaseAdapter {
        readonly name = "explicit";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          await this.inlineRules(ctx); // Will populate tracker
          // Explicit sourceFiles on one output should NOT be overwritten by
          // the adapter-wide tracked set.
          return [
            { path: "explicit.md", content: "c", sourceFiles: ["only/this.md"], action: "create" },
            output("default.md", "d"),
          ];
        }
      }
      const adapter = new ExplicitAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outputs[0]?.sourceFiles).toEqual(["only/this.md"]);
      // Second output receives the tracked set (rules contributed paths).
      expect(outputs[1]?.sourceFiles?.length).toBeGreaterThan(0);
      expect(outputs[1]?.sourceFiles?.[0]).not.toBe("only/this.md");
    });

    it("resets the tracker between successive generate() calls", async () => {
      class ResettingAdapter extends BaseAdapter {
        readonly name = "resetting";
        private readNext = true;
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          if (this.readNext) {
            await this.inlineRules(ctx);
          }
          // On the second call, readNext=false so nothing is tracked.
          this.readNext = false;
          return [output("out.md", "body")];
        }
      }
      const adapter = new ResettingAdapter();
      const first = await adapter.generate(FIXTURES_DIR, makeManifest());
      const capturedFirst: string[] | undefined = first[0]?.sourceFiles;
      const second = await adapter.generate(FIXTURES_DIR, makeManifest());
      const capturedSecond: string[] | undefined = second[0]?.sourceFiles;
      expect(capturedFirst?.length).toBeGreaterThan(0);
      // SA12.1-F-D12-M5: second run read no canonical files; tracker reset.
      // BaseAdapter now defaults to [] (not undefined) so explain --source
      // can distinguish "no tracking" from a missing field.
      expect(capturedSecond).toEqual([]);
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // `readCliFilteredSkills` is the BaseAdapter helper that implements the
  // plan §4.6 filter truth table:
  //
  //   manifest.cliTools | skill id prefix       | result
  //   ------------------+-----------------------+----------------------
  //   absent            | hatch3r-cli-*         | DROP
  //   absent            | other (e.g. test-*)   | KEEP
  //   {enabled:false}   | hatch3r-cli-*         | DROP
  //   {enabled:false}   | other                 | KEEP
  //   {enabled:true,    | hatch3r-cli-<X>       | KEEP iff X in selected
  //    selected:[X,Y]}  | other                 | KEEP
  //
  // This test reaches `readCliFilteredSkills` via a thin BaseAdapter subclass
  // (the helper is `protected` so the subclass exposes it as a public
  // wrapper). The fixture skills directory contains:
  //   - test-skill (non-CLI; always passes through)
  //   - hatch3r-cli-ripgrep (Wave 5 fixture)
  //   - hatch3r-cli-jq (Wave 5 fixture)
  //   - hatch3r-cli-fd (Wave 5 fixture)
  describe("readCliFilteredSkills (Wave 5 plan §4.6)", () => {
    /**
     * Subclass that exposes `readCliFilteredSkills` directly so we can test
     * the filter behaviour without going through the full doGenerate path.
     */
    class FilterProbe extends BaseAdapter {
      readonly name = "filter-probe";
      protected async doGenerate(): Promise<AdapterOutput[]> {
        return [output("probe.md", "x")];
      }
      // Public wrapper for testing.
      async filterSkills(ctx: AdapterContext): Promise<{ id: string }[]> {
        const skills = await this.readCliFilteredSkills(ctx);
        return skills.map((s) => ({ id: s.id }));
      }
    }

    function makeCtx(manifest: HatchManifest): AdapterContext {
      return {
        canonicalRoot: FIXTURES_DIR,
        manifest,
        features: manifest.features,
        projectRoot: "/fake/root",
        generationMode: "standard",
      };
    }

    it("drops every hatch3r-cli-* skill when manifest.cliTools is absent", async () => {
      const probe = new FilterProbe();
      const ctx = makeCtx(makeManifest());
      const ids = (await probe.filterSkills(ctx)).map((s) => s.id);

      // Non-CLI fixture passes through.
      expect(ids).toContain("test-skill");
      // All hatch3r-cli-* fixtures are dropped.
      expect(ids.some((i) => i.startsWith("hatch3r-cli-"))).toBe(false);
    });

    it("drops every hatch3r-cli-* skill when cliTools.enabled is false", async () => {
      const probe = new FilterProbe();
      const ctx = makeCtx({
        ...makeManifest(),
        cliTools: { enabled: false, selected: ["ripgrep", "jq"] },
      });
      const ids = (await probe.filterSkills(ctx)).map((s) => s.id);

      expect(ids).toContain("test-skill");
      expect(ids.some((i) => i.startsWith("hatch3r-cli-"))).toBe(false);
    });

    it("keeps only selected hatch3r-cli-* skills when enabled=true", async () => {
      const probe = new FilterProbe();
      const ctx = makeCtx({
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      });
      const ids = (await probe.filterSkills(ctx)).map((s) => s.id);

      expect(ids).toContain("test-skill"); // non-CLI passes
      expect(ids).toContain("hatch3r-cli-ripgrep");
      expect(ids).toContain("hatch3r-cli-jq");
      expect(ids).not.toContain("hatch3r-cli-fd"); // not in selected
    });

    it("keeps all non-CLI skills when cliTools.selected is empty (enabled=true)", async () => {
      const probe = new FilterProbe();
      const ctx = makeCtx({
        ...makeManifest(),
        cliTools: { enabled: true, selected: [] },
      });
      const ids = (await probe.filterSkills(ctx)).map((s) => s.id);

      // Non-CLI skill passes; no CLI skills emit (empty selection).
      expect(ids).toContain("test-skill");
      expect(ids.some((i) => i.startsWith("hatch3r-cli-"))).toBe(false);
    });

    it("treats unknown selected ids as no-match (does NOT throw)", async () => {
      const probe = new FilterProbe();
      const ctx = makeCtx({
        ...makeManifest(),
        cliTools: { enabled: true, selected: ["never-existed-tool"] },
      });
      const ids = (await probe.filterSkills(ctx)).map((s) => s.id);

      expect(ids).toContain("test-skill");
      // No CLI skill matches the unknown selection.
      expect(ids.some((i) => i.startsWith("hatch3r-cli-"))).toBe(false);
    });
  });

  // ── C9-H4: output invariant enforcement (P5 Silent Failure Contract) ──
  describe("output invariants (C9-H4)", () => {
    class TraversalAdapter extends BaseAdapter {
      readonly name = "traversal";
      constructor(private readonly badPaths: string[]) {
        super();
      }
      protected async doGenerate(): Promise<AdapterOutput[]> {
        return this.badPaths.map((p) => output(p, "valid content"));
      }
    }

    class InvariantAdapter extends BaseAdapter {
      readonly name = "invariant";
      constructor(private readonly outs: AdapterOutput[]) {
        super();
      }
      protected async doGenerate(): Promise<AdapterOutput[]> {
        return this.outs;
      }
    }

    it("throws HatchError with ADAPTER_ERROR when an output path is absolute", async () => {
      const adapter = new TraversalAdapter(["/etc/passwd"]);
      await expect(adapter.generate(FIXTURES_DIR, makeManifest())).rejects.toMatchObject({
        name: "HatchError",
        errorCode: "ADAPTER_ERROR",
      });
    });

    it("throws HatchError when an output path contains '..' traversal", async () => {
      const adapter = new TraversalAdapter(["../../escape.md"]);
      await expect(adapter.generate(FIXTURES_DIR, makeManifest())).rejects.toThrow(/traversal/);
    });

    it("includes every offending path in the error message (not just the first)", async () => {
      const adapter = new TraversalAdapter(["/abs.md", "../escape.md"]);
      await expect(adapter.generate(FIXTURES_DIR, makeManifest())).rejects.toThrow(
        /\/abs\.md.*\.\.\/escape\.md|\.\.\/escape\.md.*\/abs\.md/,
      );
    });

    // D2-SA2.1-07 (D2, P6): the "no absolute paths" contract must reject
    // Windows-absolute forms too, not only POSIX `/`-rooted paths — otherwise a
    // `C:\evil` / `C:/evil` output passes the guard despite the documented
    // invariant, and `join(rootDir, rel)` contains rather than resets it.
    it.each(["C:\\evil.md", "C:/evil.md", "d:/nested/evil.md"])(
      "throws HatchError with ADAPTER_ERROR when an output path is Windows-absolute (%s)",
      async (badPath) => {
        const adapter = new TraversalAdapter([badPath]);
        await expect(adapter.generate(FIXTURES_DIR, makeManifest())).rejects.toMatchObject({
          name: "HatchError",
          errorCode: "ADAPTER_ERROR",
        });
      },
    );

    it("drops outputs with empty content and emits a 'dropped' warning", async () => {
      const adapter = new InvariantAdapter([
        output("good.md", "ok"),
        output("empty.md", ""),
      ]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const paths = outs.map((o) => o.path);
      expect(paths).toEqual(["good.md"]);
      expect(adapter.warnings.some((w) => w.includes("Empty content") && w.includes("dropped"))).toBe(true);
    });

    it("drops outputs whose managedContent is not a substring of content", async () => {
      const adapter = new InvariantAdapter([
        output("good.md", "wrapped content here", "content here"),
        output("bad.md", "outer", "INNER NOT PRESENT"),
      ]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const paths = outs.map((o) => o.path);
      expect(paths).toEqual(["good.md"]);
      expect(adapter.warnings.some((w) => w.includes("managedContent is not a substring") && w.includes("dropped"))).toBe(true);
    });

    // D2-SA2.1-F6 (P5): the invariant filter compares `managedContent.trim()`
    // against `content` because `wrapInManagedBlock` trims the inner body
    // before wrapping (src/merge/managedBlocks.ts::wrapInManagedBlock), so the
    // legitimate adapter pattern `output(path, wrapInManagedBlock(x), x)` ships
    // an `x` with leading/trailing whitespace that never appears verbatim in
    // `content`. This locks the trim-tolerant survival path: an output whose
    // managedContent has surrounding whitespace and whose content contains only
    // the trimmed projection MUST survive. Without the `.trim()` in the filter
    // (e.g. if a future managedBlocks change broke the coupling) this output
    // would be wrongly dropped — the prior fixtures only exercised the
    // exact-substring case and would not catch that regression.
    it("keeps outputs whose managedContent has surrounding whitespace (trim-tolerant invariant)", async () => {
      const adapter = new InvariantAdapter([
        output("padded.md", "outer content here", "  content here  "),
        output("multiline.md", "prefix\n\ncontent here\n\nsuffix", "\n\ncontent here\n\n"),
      ]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      const paths = outs.map((o) => o.path);
      expect(paths).toEqual(["padded.md", "multiline.md"]);
      // The trim-tolerant survivors must NOT trigger the substring-mismatch drop.
      expect(adapter.warnings.some((w) => w.includes("managedContent is not a substring"))).toBe(false);
    });

    it("does not surface invariant warnings for valid outputs", async () => {
      const adapter = new InvariantAdapter([output("ok.md", "content")]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outs).toHaveLength(1);
      // SA12.1-F-D12-M5: BaseAdapter now warns once when an adapter emits
      // outputs without canonical-source tracking. `InvariantAdapter` synthesises
      // outputs without ever reading canonical files, so the M5 warning fires
      // (separate from the legacy "Empty content" / "managedContent not
      // substring" invariant warnings, which DO stay at 0 for valid outputs).
      const invariantWarnings = adapter.warnings.filter(
        (w) => !w.includes("canonical-source tracking"),
      );
      expect(invariantWarnings.length).toBe(0);
    });
  });

  // ── D11-3: intra-adapter output-path collision guard (P5) ──────────
  //
  // The sync-side collision check only fires across adapters; two outputs
  // from the SAME adapter at one path previously slipped through as silent
  // last-writer-wins (e.g. Copilot's regular-agent + github-agent both
  // emitting `.github/agents/{id}.agent.md`). `BaseAdapter.generate` now
  // dedupes by path, keeps the LAST occurrence, and warns per colliding path.
  describe("intra-adapter output-path collisions (D11-3)", () => {
    class CollidingAdapter extends BaseAdapter {
      readonly name = "colliding";
      constructor(private readonly outs: AdapterOutput[]) {
        super();
      }
      protected async doGenerate(): Promise<AdapterOutput[]> {
        return this.outs;
      }
    }

    it("dedupes two outputs at one path, keeping the last and warning", async () => {
      const adapter = new CollidingAdapter([
        output(".github/agents/x.agent.md", "FIRST regular-agent body"),
        output(".github/agents/x.agent.md", "SECOND github-agent body"),
      ]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      // Only one output survives for the shared path.
      const collided = outs.filter((o) => o.path === ".github/agents/x.agent.md");
      expect(collided).toHaveLength(1);
      // Last writer wins (matches the on-disk last-writer-wins reality).
      expect(collided[0].content).toBe("SECOND github-agent body");
      // The clash is audit-visible, not silent.
      expect(
        adapter.warnings.some(
          (w) =>
            w.includes("Output path collision") &&
            w.includes(".github/agents/x.agent.md"),
        ),
      ).toBe(true);
    });

    it("preserves first-seen order and leaves non-colliding paths untouched", async () => {
      const adapter = new CollidingAdapter([
        output("a.md", "a1"),
        output("b.md", "b"),
        output("a.md", "a2"),
        output("c.md", "c"),
      ]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      // a.md retained at its first-seen position with the last body; b/c intact.
      expect(outs.map((o) => o.path)).toEqual(["a.md", "b.md", "c.md"]);
      expect(outs.find((o) => o.path === "a.md")?.content).toBe("a2");
      const collisionWarnings = adapter.warnings.filter((w) =>
        w.includes("Output path collision"),
      );
      expect(collisionWarnings).toHaveLength(1);
    });

    it("emits no collision warning when every path is unique", async () => {
      const adapter = new CollidingAdapter([
        output("one.md", "1"),
        output("two.md", "2"),
      ]);
      await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(adapter.warnings.some((w) => w.includes("Output path collision"))).toBe(false);
    });
  });

  // ── C9-H20 (D8-H8.3.1): AbortSignal threading ─────────────────────
  //
  // Verifies the optional `signal?: AbortSignal` parameter on `generate`
  // is forwarded to `AdapterContext.signal`, that an already-aborted
  // signal throws before `doGenerate` runs, and that the base helpers
  // (`inlineRules`, `processSkillsRaw`, etc.) honour the signal between
  // loop iterations.
  describe("AbortSignal threading (C9-H20)", () => {
    it("forwards the signal to AdapterContext when generate is called with one", async () => {
      let captured: AbortSignal | undefined;
      class CaptureCtx extends BaseAdapter {
        readonly name = "capture-ctx";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          captured = ctx.signal;
          return [output("test.md", "c")];
        }
      }
      const controller = new AbortController();
      const adapter = new CaptureCtx();
      await adapter.generate(FIXTURES_DIR, makeManifest(), undefined, "standard", controller.signal);
      expect(captured).toBe(controller.signal);
    });

    it("leaves AdapterContext.signal undefined when generate is called without one", async () => {
      let captured: AbortSignal | undefined;
      class CaptureCtx extends BaseAdapter {
        readonly name = "capture-ctx-undef";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          captured = ctx.signal;
          return [output("test.md", "c")];
        }
      }
      const adapter = new CaptureCtx();
      await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(captured).toBeUndefined();
    });

    it("throws an AbortError when the signal is already aborted on entry", async () => {
      let doGenerateCalled = false;
      class NeverRuns extends BaseAdapter {
        readonly name = "never-runs";
        protected async doGenerate(): Promise<AdapterOutput[]> {
          doGenerateCalled = true;
          return [output("never.md", "x")];
        }
      }
      const controller = new AbortController();
      controller.abort();
      const adapter = new NeverRuns();
      await expect(
        adapter.generate(FIXTURES_DIR, makeManifest(), undefined, "standard", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      // `doGenerate` is bypassed entirely when the signal is pre-aborted.
      expect(doGenerateCalled).toBe(false);
    });

    it("rethrows the signal.reason verbatim when it is an Error", async () => {
      class Noop extends BaseAdapter {
        readonly name = "noop";
        protected async doGenerate(): Promise<AdapterOutput[]> {
          return [];
        }
      }
      const reason = new Error("explicit-reason");
      const controller = new AbortController();
      controller.abort(reason);
      const adapter = new Noop();
      await expect(
        adapter.generate(FIXTURES_DIR, makeManifest(), undefined, "standard", controller.signal),
      ).rejects.toBe(reason);
    });

    it("aborts inlineRules between iterations when the signal fires mid-loop", async () => {
      let processed = 0;
      const controller = new AbortController();
      class AbortInRules extends BaseAdapter {
        readonly name = "abort-in-rules";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          // Wrap inlineRules; we cannot easily inject a counter into the
          // helper itself, so abort the controller after the first read by
          // patching applyCustomization via a side-effect: simply abort
          // before calling, since the FIXTURES rules dir has two rules and
          // the helper checks `throwIfAborted` between them.
          // First, run one rule to ensure the loop entered.
          const lines = await this.inlineRules(ctx);
          processed = lines.length;
          return [output("rules-out.md", lines.join("\n") || "empty")];
        }
      }
      // Abort BEFORE calling generate so the inner check fires.
      controller.abort();
      const adapter = new AbortInRules();
      await expect(
        adapter.generate(FIXTURES_DIR, makeManifest(), undefined, "standard", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(processed).toBe(0); // doGenerate never ran
    });

    it("aborts mid-loop when the signal fires after the first iteration", async () => {
      // This adapter aborts the controller from inside doGenerate after
      // the loop has begun, verifying the cooperative check stops the
      // very next iteration rather than completing the full set.
      const controller = new AbortController();
      let iterations = 0;
      class MidLoopAbort extends BaseAdapter {
        readonly name = "mid-loop-abort";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          // Read both rule fixtures, but abort the signal halfway.
          const rules = await this.readTrackedCanonicalFiles(ctx, "rules");
          for (const _rule of rules) {
            this.throwIfAborted(ctx);
            iterations += 1;
            if (iterations === 1) controller.abort();
          }
          return [output("done.md", "x")];
        }
      }
      const adapter = new MidLoopAbort();
      await expect(
        adapter.generate(FIXTURES_DIR, makeManifest(), undefined, "standard", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      // First iteration ran, second was aborted.
      expect(iterations).toBe(1);
    });

    it("static throwIfSignalAborted is a no-op for an unaborted signal", () => {
      const controller = new AbortController();
      // Should not throw.
      expect(() => BaseAdapter.throwIfSignalAborted(controller.signal)).not.toThrow();
      expect(() => BaseAdapter.throwIfSignalAborted(undefined)).not.toThrow();
    });

    it("static throwIfSignalAborted constructs a generic AbortError when no reason is provided", () => {
      const controller = new AbortController();
      controller.abort();
      try {
        BaseAdapter.throwIfSignalAborted(controller.signal);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as Error).name).toBe("AbortError");
      }
    });

    it("static throwIfSignalAborted wraps a non-Error reason into an AbortError", () => {
      const controller = new AbortController();
      controller.abort("string reason");
      try {
        BaseAdapter.throwIfSignalAborted(controller.signal);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as Error).name).toBe("AbortError");
        expect((err as Error).message).toContain("string reason");
      }
    });

    it("re-checks the signal after doGenerate completes (swallowed abort still surfaces)", async () => {
      const controller = new AbortController();
      class SwallowsAbort extends BaseAdapter {
        readonly name = "swallows-abort";
        protected async doGenerate(): Promise<AdapterOutput[]> {
          // Abort during generation but do not check / propagate the
          // signal inside doGenerate. The base's post-doGenerate
          // throwIfSignalAborted must still surface the abort.
          controller.abort();
          return [output("out.md", "still produced")];
        }
      }
      const adapter = new SwallowsAbort();
      await expect(
        adapter.generate(FIXTURES_DIR, makeManifest(), undefined, "standard", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});

/**
 * D2-8 (Cycle 11 Wave 3, D2, P4/P5): processCompanionSubdir must not emit a
 * self-excluded `type: documentation` companion file (e.g. `checks/README.md`)
 * as a real artifact. The fix parses each companion file's frontmatter and
 * skips documentation-typed entries (and any README.md by name), so the
 * emission set mirrors the canonical-content reader's documentation exclusion
 * across all 3 adapters.
 */
describe("processCompanionSubdir documentation-type exclusion (D2-8)", () => {
  // Each real adapter and the native checks/ path it maps a checks/ file to.
  const adapterCases: ReadonlyArray<{
    name: string;
    make: () => BaseAdapter;
    readmePath: string;
    realCheckPath: string;
  }> = [
    {
      name: "claude",
      make: () => new ClaudeAdapter(),
      readmePath: ".claude/checks/README.md",
      realCheckPath: ".claude/checks/real-check.md",
    },
    {
      name: "cursor",
      make: () => new CursorAdapter(),
      readmePath: ".cursor/checks/README.md",
      realCheckPath: ".cursor/checks/real-check.md",
    },
    {
      name: "copilot",
      make: () => new CopilotAdapter(),
      readmePath: ".github/checks/README.md",
      realCheckPath: ".github/checks/real-check.md",
    },
  ];

  async function writeChecksFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-companion-doc-"));
    const checksDir = join(root, "checks");
    await mkdir(checksDir, { recursive: true });
    // A self-excluded authoring guide — must NOT be emitted.
    await writeFile(
      join(checksDir, "README.md"),
      `---\nid: checks-readme\ntype: documentation\ndescription: Authoring guide for the checks/ directory. Not a check.\n---\n# Checks\n\nAuthoring guide body.\n`,
      "utf-8",
    );
    // A real check — MUST be emitted.
    await writeFile(
      join(checksDir, "real-check.md"),
      `---\nid: real-check\ntype: check\ndescription: A real review-criteria check.\n---\n# Real Check\n\nPass/fail criteria body.\n`,
      "utf-8",
    );
    return root;
  }

  for (const tc of adapterCases) {
    it(`${tc.name}: drops checks/README.md (type: documentation) but emits the real check`, async () => {
      const root = await writeChecksFixture();
      try {
        const adapter = tc.make();
        const manifest = createManifest({ tools: [tc.name as never] });
        const outputs = await adapter.generate(root, manifest);
        const paths = new Set(outputs.map((o) => o.path));
        expect(paths.has(tc.readmePath)).toBe(false);
        expect(paths.has(tc.realCheckPath)).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

/**
 * D3-SA3.1-05 (Cycle 12 Wave 4, D3, CQ5): the two designed FS-error branches in
 * `processCompanionSubdir` had zero test executions — (1) the per-file readFile
 * catch that warns + `continue`s (the Silent Failure Contract surface for a
 * single unreadable companion file, base.ts:1068-1075), and (2) the readdir
 * catch's non-ENOENT rethrow (base.ts:1051-1056). POSIX-only: `chmod 000` does
 * not deny reads under Windows ACLs, so each is
 * `it.skipIf(process.platform === "win32")`-guarded and runs on the Ubuntu/macOS
 * CI legs — mirroring the established pattern in canonical.test.ts. The sibling
 * claudeAgentsMdImport stat-rethrow branch (claude.ts) is covered in
 * claude.test.ts's "AGENTS.md interop" suite.
 */
describe("processCompanionSubdir FS error branches (D3-SA3.1-05)", () => {
  async function writeChecksPair(): Promise<{ root: string; badPath: string }> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-companion-fserr-"));
    const checksDir = join(root, "checks");
    await mkdir(checksDir, { recursive: true });
    await writeFile(
      join(checksDir, "good-check.md"),
      `---\nid: good-check\ntype: check\ndescription: A readable review-criteria check.\n---\n# Good\n\nBody.\n`,
      "utf-8",
    );
    const badPath = join(checksDir, "bad-check.md");
    await writeFile(
      badPath,
      `---\nid: bad-check\ntype: check\ndescription: A check the test makes unreadable.\n---\n# Bad\n\nBody.\n`,
      "utf-8",
    );
    return { root, badPath };
  }

  it.skipIf(process.platform === "win32")(
    "warns and continues when one companion file is unreadable (readFile catch)",
    async () => {
      const { root, badPath } = await writeChecksPair();
      try {
        await chmod(badPath, 0o000);
        const adapter = new ClaudeAdapter();
        const manifest = createManifest({ tools: ["claude"] });
        const outputs = await adapter.generate(root, manifest);
        const paths = new Set(outputs.map((o) => o.path));
        // The readable check still emits; the unreadable one is skipped, not fatal.
        expect(paths.has(".claude/checks/good-check.md")).toBe(true);
        expect(paths.has(".claude/checks/bad-check.md")).toBe(false);
        // The skip is surfaced (Silent Failure Contract) — the warning names the file.
        expect(
          adapter.warnings.some(
            (w) =>
              w.includes("failed to read companion file") && w.includes("bad-check.md"),
          ),
        ).toBe(true);
      } finally {
        await chmod(badPath, 0o644).catch(() => {});
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects when a companion directory is unreadable (readdir non-ENOENT rethrow)",
    async () => {
      const { root } = await writeChecksPair();
      const checksDir = join(root, "checks");
      try {
        await chmod(checksDir, 0o000);
        const adapter = new ClaudeAdapter();
        const manifest = createManifest({ tools: ["claude"] });
        // readdir(checksDir) throws EACCES (non-ENOENT) → processCompanionSubdir
        // rethrows rather than swallowing → generate rejects (does not silently
        // ship an incomplete companion subtree).
        await expect(adapter.generate(root, manifest)).rejects.toThrow();
      } finally {
        await chmod(checksDir, 0o755).catch(() => {});
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

/**
 * D2-SA2.1-01 (Cycle 12 Wave 2, D2, P5): KNOWN_COMPANION_SUBDIRS is a static
 * hand-enumerated tuple with no completeness invariant against the on-disk
 * canonical tree, so `commands/shared/` (added Cycle 11, home of the
 * orchestration-frame every emitted orchestrator command references) was omitted
 * for ~2 weeks while no adapter shipped it. This invariant walks the actual
 * canonical `agents/`+`commands/` subdirectories (mirroring the dynamic copy path
 * in src/content/index.ts) and fails if the tuple omits a discovered member — so
 * the next companion class cannot land in the tree without being wired here.
 */
describe("KNOWN_COMPANION_SUBDIRS completeness invariant (D2-SA2.1-01)", () => {
  const repoRoot = resolveTestPath(import.meta.url, "../../../");

  it("names every non-hatch3r-prefixed subdirectory of agents/ and commands/", async () => {
    const discovered = new Set<string>();
    for (const parent of ["agents", "commands"] as const) {
      const entries = await readdir(join(repoRoot, parent), { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith("hatch3r-")) {
          discovered.add(`${parent}/${e.name}`);
        }
      }
    }
    // `checks/` is a top-level content dir (not under agents/ or commands/), so
    // it is excluded from this discovered comparison set.
    const expected = new Set(KNOWN_COMPANION_SUBDIRS.filter((s) => s !== "checks"));
    expect(discovered).toEqual(expected);
  });
});

/**
 * D2-SA2.1-01 (Cycle 12 Wave 2, D2, P5): the fix that closes the omission — each
 * adapter's `companionMappings` array must now ship `commands/shared/` under its
 * native command-companion path, so the references all 31 emitted orchestrator
 * commands carry to `commands/shared/orchestration-frame.md` resolve on disk.
 */
describe("commands/shared companion emission (D2-SA2.1-01)", () => {
  const adapterCases: ReadonlyArray<{
    name: string;
    make: () => BaseAdapter;
    emittedPath: string;
  }> = [
    { name: "claude", make: () => new ClaudeAdapter(), emittedPath: ".claude/commands/shared/orchestration-frame.md" },
    { name: "cursor", make: () => new CursorAdapter(), emittedPath: ".cursor/commands/shared/orchestration-frame.md" },
    // Copilot routes command companions under `.github/prompts/` (board/rework).
    { name: "copilot", make: () => new CopilotAdapter(), emittedPath: ".github/prompts/shared/orchestration-frame.md" },
  ];

  async function writeSharedFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-cmd-shared-"));
    const dir = join(root, "commands", "shared");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "orchestration-frame.md"),
      "---\nid: orchestration-frame\ntype: shared-context\ndescription: Shared orchestration frame consumed by every orchestrator command.\n---\n# Orchestration Frame\n\nFrame body.\n",
      "utf-8",
    );
    return root;
  }

  for (const tc of adapterCases) {
    it(`${tc.name}: ships commands/shared/orchestration-frame.md under the native command-companion path`, async () => {
      const root = await writeSharedFixture();
      try {
        const manifest = createManifest({ tools: [tc.name as never], features: { commands: true } });
        const outputs = await tc.make().generate(root, manifest);
        const paths = new Set(outputs.map((o) => o.path));
        expect(paths.has(tc.emittedPath), `expected ${tc.emittedPath}`).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

/**
 * D11-16 (Cycle 11 Wave 3, D11, P5/SA11.3-F4): MCP validation warnings are
 * scoped to the SELECTED + enabled servers, not the whole bundle. A 2-server
 * selection must not surface validation warnings about the other servers
 * (including a disabled one). The fix runs validateMcpEntry/scanMcpServers
 * AFTER the selection + `_disabled` filter inside readFilteredMcp.
 */
describe("MCP validation warning scope (D11-16)", () => {
  class McpProbeAdapter extends ClaudeAdapter {}

  async function writeMultiServerFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-mcp-scope-"));
    await mkdir(join(root, "mcp"), { recursive: true });
    await writeFile(
      join(root, "mcp", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          // Selected + valid.
          github: { _trust_bypass: true, url: "https://api.githubcopilot.com/mcp/" },
          // Selected + valid stdio.
          "brave-search": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-brave-search"],
          },
          // Disabled — must never produce a warning even though it would fail
          // the HTTP-pin policy (no pin, no trust_bypass).
          gitlab: { _disabled: true, url: "https://gitlab.example.com/mcp" },
          // Unselected + would warn (unrecognized command). Must stay silent.
          "noisy-bash": { command: "bash", args: ["-c", "echo hi"] },
          // Unselected + would warn (unpinned http). Must stay silent.
          "noisy-http": { url: "https://untrusted.example.com/mcp" },
          // Unselected + would warn (unpinned npx package). Must stay silent.
          "noisy-npx": { command: "npx", args: ["-y", "some-unpinned-pkg"] },
        },
      }),
      "utf-8",
    );
    return root;
  }

  it("emits no validation warnings about unselected or disabled servers", async () => {
    const root = await writeMultiServerFixture();
    try {
      const adapter = new McpProbeAdapter();
      const manifest = createManifest({
        tools: ["claude"],
        mcpServers: ["github", "brave-search"],
        // W3-mcp-optin: pin MCP on (now opt-in) so readFilteredMcp runs and
        // the warning-scope assertion is non-vacuous.
        features: { mcp: true },
      });
      await adapter.generate(root, manifest);

      // No warning may name any unselected or disabled server.
      for (const silent of ["gitlab", "noisy-bash", "noisy-http", "noisy-npx"]) {
        expect(
          adapter.warnings.some((w) => w.includes(`"${silent}"`)),
          `expected no warning mentioning unselected/disabled server "${silent}", got: ${JSON.stringify(adapter.warnings)}`,
        ).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still surfaces a validation warning for a SELECTED server with an issue", async () => {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-mcp-scope-sel-"));
    try {
      await mkdir(join(root, "mcp"), { recursive: true });
      await writeFile(
        join(root, "mcp", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            // Selected but unpinned npx — validateMcpEntry warns; the server
            // still emits (warn-only), so the warning must reach the operator.
            "selected-noisy": { command: "npx", args: ["-y", "some-unpinned-pkg"] },
          },
        }),
        "utf-8",
      );
      const adapter = new McpProbeAdapter();
      const manifest = createManifest({
        tools: ["claude"],
        mcpServers: ["selected-noisy"],
        // W3-mcp-optin: pin MCP on (now opt-in) so the selected server is
        // actually validated and the warning surfaces.
        features: { mcp: true },
      });
      await adapter.generate(root, manifest);
      expect(
        adapter.warnings.some(
          (w) => w.includes('"selected-noisy"') && w.includes("unpinned"),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * D3-8 (Cycle 11 Wave 3, D2/D3, P8 B1): the `<!-- HATCH3R:PLATFORM-TOOL -->`
 * marker substitution is verified THROUGH real adapter output, not only at the
 * helper layer. A shared `agents/shared/` companion body carrying the marker is
 * run through all 3 adapters; each emission must contain the native platform
 * note AND must NOT leak the raw marker comment. A marker-spelling drift (the
 * helper no longer matching the canonical token) would fail this gate instead
 * of silently shipping the raw comment to every adapter.
 */
describe("PLATFORM-TOOL marker substitution through adapter output (D3-8)", () => {
  const adapterCases: ReadonlyArray<{
    name: string;
    make: () => BaseAdapter;
    emittedPath: string;
    // A substring of the substituted native note unique to this adapter.
    nativeNote: string;
  }> = [
    {
      name: "claude",
      make: () => new ClaudeAdapter(),
      emittedPath: ".claude/agents/shared/marker-fixture.md",
      // claude has a documented native tool (AskUserQuestion).
      nativeNote: "AskUserQuestion",
    },
    {
      name: "cursor",
      make: () => new CursorAdapter(),
      emittedPath: ".cursor/agents/shared/marker-fixture.md",
      // cursor has no native tool — falls back to the plain-text note.
      nativeNote: "No documented native question tool for `cursor`",
    },
    {
      name: "copilot",
      make: () => new CopilotAdapter(),
      emittedPath: ".github/agents/shared/marker-fixture.md",
      nativeNote: "No documented native question tool for `copilot`",
    },
  ];

  async function writeMarkerFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "hatch3r-platform-marker-"));
    const sharedDir = join(root, "agents", "shared");
    await mkdir(sharedDir, { recursive: true });
    await writeFile(
      join(sharedDir, "marker-fixture.md"),
      `---\nid: marker-fixture\ntype: reference\ndescription: Companion fixture carrying the platform-tool marker.\n---\n# Marker Fixture\n\nAsk the user using the platform-native tool.\n\n${PLATFORM_TOOL_MARKER}\n\nThen continue.\n`,
      "utf-8",
    );
    return root;
  }

  for (const tc of adapterCases) {
    it(`${tc.name}: substitutes the native note and leaks no raw marker`, async () => {
      const root = await writeMarkerFixture();
      try {
        const adapter = tc.make();
        const manifest = createManifest({ tools: [tc.name as never] });
        const outputs = await adapter.generate(root, manifest);
        const emitted = outputs.find((o) => o.path === tc.emittedPath);
        expect(emitted, `expected companion output at ${tc.emittedPath}`).toBeDefined();
        expect(emitted!.content).toContain(tc.nativeNote);
        expect(emitted!.content).not.toContain("HATCH3R:PLATFORM-TOOL");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

// D9-SA9.4-01 (Cycle 12, D9, P3): the adapter-capability-matrix's File Path
// Mapping rows are hand-maintained and had drifted from adapter ground truth for
// cycles — the rule-path rows omitted the NN- precedence prefix that shipped in
// 1.6.0 (~196 mis-documented filenames). Close that drift class mechanically:
// run each adapter against the canonical corpus and reconcile the emitted
// rule-file shape against what the matrix documents. A future prefix change (in
// the adapter OR the doc) fails here instead of silently misleading readers.
describe("adapter-capability-matrix rule-path rows <-> adapter ground truth (D9-SA9.4-01)", () => {
  // Repo root from src/__tests__/adapters/ is three levels up; the top-level
  // canonical dirs (rules/, agents/, ...) live there, so this needs no build
  // (matches the resolution convention in capability-matrix-doc.test.ts).
  const ROOT = resolve(import.meta.dirname, "..", "..", "..");
  const doc = readFileSync(resolve(ROOT, "docs", "adapter-capability-matrix.md"), "utf-8");

  const cases = [
    {
      name: "cursor" as const,
      make: () => new CursorAdapter(),
      rulePat: /^\.cursor\/rules\/(10|30|50|70)-hatch3r-.+\.mdc$/,
      docForm: ".cursor/rules/{NN}-hatch3r-{id}.mdc",
      staleRow: "| rules | `.cursor/rules/hatch3r-{id}.mdc`",
    },
    {
      name: "claude" as const,
      make: () => new ClaudeAdapter(),
      rulePat: /^\.claude\/rules\/(10|30|50|70)-hatch3r-.+\.md$/,
      docForm: ".claude/rules/{NN}-hatch3r-{id}.md",
      staleRow: "| rules | `.claude/rules/hatch3r-{id}.md`",
    },
    {
      name: "copilot" as const,
      make: () => new CopilotAdapter(),
      rulePat: /^\.github\/instructions\/(10|30|50|70)-hatch3r-.+\.instructions\.md$/,
      docForm: ".github/instructions/{NN}-hatch3r-{id}.instructions.md",
      staleRow: "| rules (scoped) | `.github/instructions/hatch3r-{id}.instructions.md`",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: emits NN-prefixed rule files and the matrix documents that form`, async () => {
      const paths = await c.make().getOutputPaths(ROOT, createManifest({ tools: [c.name] }));
      // Ground truth: canonical rules emit under the NN- precedence prefix.
      expect(paths.some((p) => c.rulePat.test(p))).toBe(true);
      // Doc reconciliation: the matrix documents the NN-prefixed form ...
      expect(doc).toContain(c.docForm);
      // ... and no longer carries the stale unprefixed rule row.
      expect(doc).not.toContain(c.staleRow);
    });
  }
});

// D2-SA2.1-02 (Cycle 12 Wave 3, D2, P2): `getOutputPaths` was 2-arg
// (canonical-only) while real generation threads `userRepoRoot`, so `update.ts`'s
// D1-4 rollback pre-enumeration recorded a strict subset of the real output set —
// a newly-created user-override output escaped tombstoning and survived a
// rollback. The fix widens `getOutputPaths(canonicalRoot, manifest, userRepoRoot?)`
// and forwards the arg to `generate`. D3-SA3.1-03: the memo is now keyed on the
// full argument tuple (the prior cache was argument-insensitive).

// Minimal adapter that enumerates one output per user-facing agent, so a
// user-tier override at `${userRoot}/.hatch3r/overrides/agents/<id>.md`
// produces a distinct output path. `doGenerateCalls` pins the cache hit/miss
// pattern for the D3-SA3.1-03 memo test.
class AgentEnumAdapter extends BaseAdapter {
  readonly name = "agent-enum";
  doGenerateCalls = 0;
  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    this.doGenerateCalls += 1;
    const agents = await this.readUserFacingCanonicalFiles(ctx, "agents");
    return agents.map((a) => output(`agents/${a.id}.md`, `# ${a.id}\n`));
  }
}

// Stage a valid user-tier agent override (mirrors userContentParity.test.ts's
// seedUserAgent: id/type/description/tags/pillars, description long enough to
// clear the adapter description gate) at `${userRoot}/.hatch3r/overrides/agents/`.
async function seedUserAgentFile(userRoot: string, id: string): Promise<void> {
  const dir = join(userRoot, ".hatch3r", "overrides", "agents");
  await mkdir(dir, { recursive: true });
  const desc =
    "User-tier agent fixture with a description long enough to clear the adapter description gate.";
  await writeFile(
    join(dir, `${id}.md`),
    `---\nid: ${id}\ntype: agent\ndescription: ${desc}\ntags: [customize]\nquality_charter: agents/shared/quality-charter.md\npillars: [P4]\n---\nUser body for ${id}.\n`,
  );
}

describe("getOutputPaths threads userRepoRoot for user-tier parity (D2-SA2.1-02)", () => {
  it("enumerates user-override outputs only when userRepoRoot is threaded, matching generate()", async () => {
    const userRoot = await mkdtemp(join(tmpdir(), "hatch3r-getoutputpaths-uc-"));
    try {
      await seedUserAgentFile(userRoot, "user-extra");
      const manifest = makeManifest();

      // getOutputPaths WITH userRepoRoot must equal the real generate() path set
      // AND include the user-override-derived output (the D1-4 tombstone gap).
      const enumWithUser = await new AgentEnumAdapter().getOutputPaths(FIXTURES_DIR, manifest, userRoot);
      const genWithUser = (await new AgentEnumAdapter().generate(FIXTURES_DIR, manifest, userRoot)).map(
        (o) => o.path,
      );
      expect(new Set(enumWithUser)).toEqual(new Set(genWithUser));
      expect(enumWithUser).toContain("agents/user-extra.md");

      // Omitting userRepoRoot enumerates the canonical-only subset (no user path).
      const enumNoUser = await new AgentEnumAdapter().getOutputPaths(FIXTURES_DIR, manifest);
      expect(enumNoUser).not.toContain("agents/user-extra.md");
      // The user path is exactly what threading the arg adds — nothing else moves.
      expect(new Set(enumWithUser)).toEqual(new Set([...enumNoUser, "agents/user-extra.md"]));
    } finally {
      await rm(userRoot, { recursive: true, force: true });
    }
  });
});

describe("getOutputPaths cache is keyed on its arguments (D3-SA3.1-03)", () => {
  it("memoises identical calls but recomputes when userRepoRoot differs", async () => {
    const userRoot = await mkdtemp(join(tmpdir(), "hatch3r-getoutputpaths-cache-"));
    try {
      await seedUserAgentFile(userRoot, "cache-user");
      const adapter = new AgentEnumAdapter();
      const manifest = makeManifest();

      // Two identical calls → a single generation (the second is a cache hit).
      const first = await adapter.getOutputPaths(FIXTURES_DIR, manifest, userRoot);
      const second = await adapter.getOutputPaths(FIXTURES_DIR, manifest, userRoot);
      expect(adapter.doGenerateCalls).toBe(1);
      expect(second).toEqual(first);
      expect(first).toContain("agents/cache-user.md");

      // A call with a DIFFERENT userRepoRoot (omitted) must recompute — the
      // pre-fix argument-insensitive cache returned the memoised user-tier set.
      const canonicalOnly = await adapter.getOutputPaths(FIXTURES_DIR, manifest);
      expect(adapter.doGenerateCalls).toBe(2);
      expect(canonicalOnly).not.toContain("agents/cache-user.md");
    } finally {
      await rm(userRoot, { recursive: true, force: true });
    }
  });
});

// D3-SA3.1-01 (Cycle 12 Wave 3, D3, CQ5): `generate()` falls back to
// `process.cwd()` for projectRoot when userRepoRoot is omitted, and
// applyCustomization probes `.hatch3r/{type}/{id}.customize.*` against it — so a
// call that omits the arg reads customization from the developer's live repo
// `.hatch3r/`. This guards the base-level isolation contract: when userRepoRoot
// IS passed, the customization outcome is a function of that directory alone, so
// a `.hatch3r/agents/*.customize.yaml` sitting in any OTHER directory (including
// cwd) has zero effect. (The 127-call test-site sweep that omits the arg lives in
// the claude/cursor/copilot/snapshots adapter test files, out of this file's scope.)
describe("customization probes resolve against the passed userRepoRoot, not cwd (D3-SA3.1-01)", () => {
  class InlineAgentsProbe extends BaseAdapter {
    readonly name = "inline-agents-probe";
    protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
      const lines = await this.inlineAgents(ctx);
      return [output("agents-out.md", lines.join("\n") || "empty")];
    }
  }

  it("a .hatch3r/agents customize file only affects generate() when userRepoRoot points at its directory", async () => {
    const dirWithCustomize = await mkdtemp(join(tmpdir(), "hatch3r-cwd-probe-with-"));
    const dirWithoutCustomize = await mkdtemp(join(tmpdir(), "hatch3r-cwd-probe-none-"));
    try {
      // A customize file that disables the canonical test-agent (non-protected,
      // non-floor → `enabled: false` is honored as a skip).
      const customizeDir = join(dirWithCustomize, ".hatch3r", "agents");
      await mkdir(customizeDir, { recursive: true });
      await writeFile(join(customizeDir, "test-agent.customize.yaml"), "enabled: false\n");

      const manifest = makeManifest();
      const marker = "## Agent: test-agent";

      // userRepoRoot = the dir WITH the customize file → projectRoot resolves
      // there → test-agent is disabled (skip) → marker absent. Proves the file
      // is genuinely effective (so the isolation assertion below is non-vacuous).
      const disabled = (
        await new InlineAgentsProbe().generate(FIXTURES_DIR, manifest, dirWithCustomize)
      )[0]!.content;
      expect(disabled).not.toContain(marker);

      // userRepoRoot = a DIFFERENT dir with no customization → the customize file
      // in dirWithCustomize (analogue of a cwd `.hatch3r/`) has zero effect →
      // output is unchanged from the un-customized baseline (marker present).
      const unaffected = (
        await new InlineAgentsProbe().generate(FIXTURES_DIR, manifest, dirWithoutCustomize)
      )[0]!.content;
      expect(unaffected).toContain(marker);
    } finally {
      await rm(dirWithCustomize, { recursive: true, force: true });
      await rm(dirWithoutCustomize, { recursive: true, force: true });
    }
  });
});

// ── D10-SA10.6-01 (release/2.8.6): selection-allowlist emission filtering ──
//
// `manifest.content.items` is now an emission allowlist: `filterBySelection`
// runs inside readTrackedCanonicalFiles / readUserFacingCanonicalFiles after
// the adapter-scope filter, so a `hatch3r config` removal genuinely stops the
// artifact emitting. `buildSelectionAllowlist` derives the per-class sets and
// fails open (null → filter disabled) on absent content or an empty union.

function makeSelection(items: Partial<ContentSelection["items"]>): ContentSelection {
  return {
    preset: "custom",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: [],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
      ...items,
    },
  };
}

describe("buildSelectionAllowlist (D10-SA10.6-01)", () => {
  it("returns null when content is absent (legacy manifests: filter disabled)", () => {
    expect(buildSelectionAllowlist(undefined)).toBeNull();
  });

  it("returns null when the union of every items array is empty (fail-open)", () => {
    expect(buildSelectionAllowlist(makeSelection({}))).toBeNull();
  });

  it("builds per-class sets and leaves a missing/non-array class key unfiltered", () => {
    const content = makeSelection({ agents: ["test-agent"], rules: ["test-rule"] });
    // Simulate a hand-edited manifest: drop one class key entirely and
    // corrupt another to a non-array.
    delete (content.items as Partial<ContentSelection["items"]>).commands;
    (content.items as unknown as Record<string, unknown>).skills = "not-an-array";
    const allow = buildSelectionAllowlist(content);
    expect(allow).not.toBeNull();
    expect(allow!.agents).toEqual(new Set(["test-agent"]));
    expect(allow!.rules).toEqual(new Set(["test-rule"]));
    // Missing / non-array class keys carry NO set → class unfiltered.
    expect(allow!.commands).toBeUndefined();
    expect(allow!.skills).toBeUndefined();
    // Present-but-empty classes DO carry an (empty) set — a real zero-selection.
    expect(allow!.githubAgents).toEqual(new Set());
  });

  it("never carries a hooks entry (v1 asymmetry) while hooks ids still count toward the union", () => {
    // A selection whose ONLY populated class is hooks: the union is non-empty
    // (filter enabled) but the hooks class itself is never filtered — hook
    // markdown feeds the settings/hooks.json config artifacts and the ASI02
    // guard entries must not be droppable via a stale selection.
    const allow = buildSelectionAllowlist(makeSelection({ hooks: ["pre-commit-lint-fixer"] }));
    expect(allow).not.toBeNull();
    expect(allow!.hooks).toBeUndefined();
  });
});

describe("selection-allowlist filtering through the canonical readers (D10-SA10.6-01)", () => {
  class SelectionProbeAdapter extends BaseAdapter {
    readonly name = "selection-probe";
    seen: Record<string, string[]> = {};
    protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
      this.seen.rules = (await this.readTrackedCanonicalFiles(ctx, "rules")).map((f) => f.id);
      this.seen.skills = (await this.readTrackedCanonicalFiles(ctx, "skills")).map((f) => f.id);
      this.seen.githubAgents = (await this.readTrackedCanonicalFiles(ctx, "github-agents")).map((f) => f.id);
      this.seen.agents = (await this.readUserFacingCanonicalFiles(ctx, "agents")).map((f) => f.id);
      this.seen.commands = (await this.readUserFacingCanonicalFiles(ctx, "commands")).map((f) => f.id);
      return [output("probe.md", "x")];
    }
  }

  it("emits only selected ids per class; commands match via their cmd- selection form", async () => {
    const adapter = new SelectionProbeAdapter();
    const manifest = makeManifest({
      content: makeSelection({
        agents: ["test-agent"],
        rules: ["scoped-rule"],
        skills: ["test-skill"],
        // Selection stores commands cmd-prefixed (applyCommandPrefix on
        // catalog items); the adapter-side CanonicalFile.id is bare.
        commands: ["cmd-test-command"],
        githubAgents: ["test-gh-agent"],
      }),
    });
    await adapter.generate(FIXTURES_DIR, manifest);
    expect(adapter.seen.agents).toEqual(["test-agent"]); // readonly-agent dropped
    expect(adapter.seen.rules).toEqual(["scoped-rule"]); // test-rule dropped
    // CLI-tooling skills are EXEMPT from the selection seam (review fix F1:
    // governed by manifest.cliTools via readCliFilteredSkills, never
    // double-gated by content.items) — the raw skills read keeps them; the
    // non-cli test-skill is kept because it is selected.
    expect(adapter.seen.skills).toEqual([
      "hatch3r-cli-fd",
      "hatch3r-cli-jq",
      "hatch3r-cli-ripgrep",
      "test-skill",
    ]);
    expect(adapter.seen.commands).toEqual(["test-command"]);
    expect(adapter.seen.githubAgents).toEqual(["test-gh-agent"]);
    // A selection-configured full-class read carries no fail-open warning.
    expect(adapter.warnings.filter((w) => w.includes("selection"))).toEqual([]);
  });

  it("drops a command whose cmd- selection entry is absent", async () => {
    const adapter = new SelectionProbeAdapter();
    const manifest = makeManifest({
      content: makeSelection({
        agents: ["test-agent"],
        commands: ["cmd-some-other-command"],
      }),
    });
    await adapter.generate(FIXTURES_DIR, manifest);
    expect(adapter.seen.commands).toEqual([]);
  });

  it("tolerates legacy bare selection ids (no cmd-/hatch3r- prefix)", async () => {
    const adapter = new SelectionProbeAdapter();
    const manifest = makeManifest({
      content: makeSelection({
        agents: ["test-agent"],
        // Legacy form: un-cmd-prefixed command id. (The bare-id skill case
        // is exercised at the isIdInSelection level via customizationSummary
        // tests — the fixture's only hatch3r-prefixed skills are the
        // hatch3r-cli-* set, which is exempt from this seam per review fix
        // F1, so it cannot demonstrate skill bare-id tolerance here.)
        commands: ["test-command"],
      }),
    });
    await adapter.generate(FIXTURES_DIR, manifest);
    expect(adapter.seen.commands).toEqual(["test-command"]);
  });

  it("CLI-tooling skills compose with manifest.cliTools, never the content selection (review fix F1)", async () => {
    // The reviewer's reproduction: a custom selection that lists NO
    // hatch3r-cli-* id (config/cli-tools flows never write them into
    // content.items) plus an enabled cliTools pick. The selection seam must
    // keep the cli class untouched so readCliFilteredSkills — the class's
    // own selection surface — decides alone.
    class CliFilteredProbe extends BaseAdapter {
      readonly name = "cli-filtered-probe";
      seen: string[] = [];
      protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
        this.seen = (await this.readCliFilteredSkills(ctx)).map((f) => f.id);
        return [output("probe.md", "x")];
      }
    }
    const adapter = new CliFilteredProbe();
    const manifest = makeManifest({
      content: makeSelection({ skills: ["test-skill"] }),
      cliTools: { enabled: true, selected: ["jq"] },
    });
    await adapter.generate(FIXTURES_DIR, manifest);
    // jq survives BOTH gates (cliTools selects it; selection exempts it);
    // fd/ripgrep are dropped by the cliTools filter alone; test-skill is
    // selection-kept.
    expect(adapter.seen).toEqual(["hatch3r-cli-jq", "test-skill"]);
  });

  it("emits everything when manifest.content is absent (filter disabled, no warning)", async () => {
    const adapter = new SelectionProbeAdapter();
    await adapter.generate(FIXTURES_DIR, makeManifest());
    expect(adapter.seen.agents).toEqual(expect.arrayContaining(["test-agent", "readonly-agent"]));
    expect(adapter.seen.rules).toEqual(expect.arrayContaining(["scoped-rule", "test-rule"]));
    expect(adapter.seen.commands).toEqual(["test-command"]);
    expect(adapter.warnings.filter((w) => w.includes("selection filtering"))).toEqual([]);
  });

  it("fails open with ONE warning when content is present but the selection union is empty", async () => {
    const adapter = new SelectionProbeAdapter();
    const manifest = makeManifest({ content: makeSelection({}) });
    await adapter.generate(FIXTURES_DIR, manifest);
    // Full emission (the empty-union legacy/workspace shape must not emit nothing).
    expect(adapter.seen.agents).toEqual(expect.arrayContaining(["test-agent", "readonly-agent"]));
    expect(adapter.seen.rules).toEqual(expect.arrayContaining(["scoped-rule", "test-rule"]));
    // Exactly one fail-open warning despite five reader calls (lazy memo).
    const warnings = adapter.warnings.filter((w) => w.includes("selection filtering is disabled"));
    expect(warnings).toHaveLength(1);
  });

  it("a class with a present-but-empty array (non-empty union elsewhere) emits only protected items of that class", async () => {
    const adapter = new SelectionProbeAdapter();
    const manifest = makeManifest({
      content: makeSelection({ agents: ["test-agent"] }), // rules: [] with a non-empty union
    });
    await adapter.generate(FIXTURES_DIR, manifest);
    expect(adapter.seen.rules).toEqual([]); // no fixture rule is protected
    expect(adapter.seen.agents).toEqual(["test-agent"]);
  });

  it("protected artifacts bypass the filter and warn when missing from the selection", async () => {
    // The shipped fixtures carry no protected artifact, so stage a canonical
    // root with one protected and one plain agent.
    const canonicalRoot = await mkdtemp(join(tmpdir(), "hatch3r-selection-protected-"));
    try {
      await mkdir(join(canonicalRoot, "agents"), { recursive: true });
      await writeFile(
        join(canonicalRoot, "agents", "protected-agent.md"),
        "---\nid: protected-agent\ntype: agent\ndescription: A protected fixture agent\nprotected: true\n---\n# Protected\n",
      );
      await writeFile(
        join(canonicalRoot, "agents", "plain-agent.md"),
        "---\nid: plain-agent\ntype: agent\ndescription: A plain fixture agent\n---\n# Plain\n",
      );
      const adapter = new SelectionProbeAdapter();
      const manifest = makeManifest({
        // Selection names ONLY the plain agent — the protected one is absent
        // (a state only a hand-edited manifest can produce; resolveSelection
        // admits protected ids unconditionally).
        content: makeSelection({ agents: ["plain-agent"] }),
      });
      await adapter.generate(canonicalRoot, manifest);
      expect(adapter.seen.agents).toEqual(expect.arrayContaining(["plain-agent", "protected-agent"]));
      const protectedWarnings = adapter.warnings.filter(
        (w) => w.includes('protected artifact "protected-agent"') && w.includes("items.agents"),
      );
      expect(protectedWarnings).toHaveLength(1);
    } finally {
      await rm(canonicalRoot, { recursive: true, force: true });
    }
  });

  it("user-tier artifacts skip the selection filter (adapter-scope governs them)", async () => {
    const userRoot = await mkdtemp(join(tmpdir(), "hatch3r-selection-user-"));
    try {
      await seedUserAgentFile(userRoot, "user-extra");
      const adapter = new SelectionProbeAdapter();
      const manifest = makeManifest({
        // Selection names only the canonical test-agent; the user-tier id is
        // NOT in the selection (content.items tracks canonical ids only) and
        // must still emit.
        content: makeSelection({ agents: ["test-agent"] }),
      });
      await adapter.generate(FIXTURES_DIR, manifest, userRoot);
      expect(adapter.seen.agents).toEqual(expect.arrayContaining(["test-agent", "user-extra"]));
      expect(adapter.seen.agents).not.toContain("readonly-agent");
    } finally {
      await rm(userRoot, { recursive: true, force: true });
    }
  });
});

// ── sec-2.8.6-b2-p4 / test-2.8.6-b2-p4: Phase-4 validation additions ──

describe("floor:security drop escalation (sec-2.8.6-b2-p4 #5)", () => {
  it("warns when a selection-dropped rule carries floor:security (still dropped — selection trusted)", async () => {
    const canonicalRoot = await mkdtemp(join(tmpdir(), "hatch3r-floor-sec-"));
    try {
      await mkdir(join(canonicalRoot, "rules"), { recursive: true });
      await writeFile(
        join(canonicalRoot, "rules", "hatch3r-sec-floor-rule.md"),
        "---\nid: hatch3r-sec-floor-rule\ntype: rule\ndescription: A security-floor fixture rule\ntags: [floor:security]\n---\n# Sec floor\n",
      );
      await writeFile(
        join(canonicalRoot, "rules", "hatch3r-plain-rule.md"),
        "---\nid: hatch3r-plain-rule\ntype: rule\ndescription: A plain fixture rule\n---\n# Plain\n",
      );
      class RulesProbe extends BaseAdapter {
        readonly name = "rules-probe";
        seen: string[] = [];
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          this.seen = (await this.readTrackedCanonicalFiles(ctx, "rules")).map((f) => f.id);
          return [output("probe.md", "x")];
        }
      }
      const adapter = new RulesProbe();
      const manifest = makeManifest({
        // Selection keeps only the plain rule — the floor:security rule is
        // dropped (hand-edited state; resolveSelection admits floor content).
        content: makeSelection({ rules: ["hatch3r-plain-rule"] }),
      });
      await adapter.generate(canonicalRoot, manifest);
      // Dropped, not bypassed: the selection is trusted.
      expect(adapter.seen).toEqual(["hatch3r-plain-rule"]);
      // Escalated to a warning-level diagnostic naming the artifact + tag.
      const escalations = adapter.warnings.filter(
        (w) => w.includes('security-floor artifact "hatch3r-sec-floor-rule"') && w.includes("floor:security"),
      );
      expect(escalations).toHaveLength(1);
    } finally {
      await rm(canonicalRoot, { recursive: true, force: true });
    }
  });
});

describe("selection filter provenance ordering (test-2.8.6-b2-p4 #6)", () => {
  it("a selection-dropped rule never enters the tracked sourceFiles set", async () => {
    class RulesProvenanceProbe extends BaseAdapter {
      readonly name = "rules-provenance-probe";
      protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
        await this.readTrackedCanonicalFiles(ctx, "rules");
        // Aggregate output with no self-attribution — inherits the tracked set.
        return [output("agg.md", "aggregate")];
      }
    }
    const adapter = new RulesProvenanceProbe();
    const manifest = makeManifest({
      content: makeSelection({ rules: ["scoped-rule"] }),
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);
    const sources = outputs[0]?.sourceFiles ?? [];
    // The filter runs BEFORE provenance tracking, so the dropped rule's
    // sourcePath never reaches the adapter-wide tracked set.
    expect(sources.some((s) => s.endsWith("scoped-rule.md"))).toBe(true);
    expect(sources.some((s) => s.endsWith("test-rule.md"))).toBe(false);
  });
});

describe("classifySelection unit table (test-2.8.6-b2-p4 #9)", () => {
  const allow = buildSelectionAllowlist(
    makeSelection({ agents: ["kept-agent"], skills: ["kept-skill"], commands: ["cmd-kept-command"] }),
  );

  const cases: Array<{
    name: string;
    file: { id: string; type: string; source?: "canonical" | "user"; protected?: boolean };
    expected: "keep" | "drop" | "keep-protected-missing";
  }> = [
    { name: "user-tier file keeps regardless of membership", file: { id: "anything", type: "agent", source: "user" }, expected: "keep" },
    { name: "cli-tooling skill keeps (own cliTools surface)", file: { id: "hatch3r-cli-jq", type: "skill" }, expected: "keep" },
    { name: "type without a selection key keeps (!key arm)", file: { id: "accessibility", type: "check" }, expected: "keep" },
    { name: "selected plain member keeps", file: { id: "kept-agent", type: "agent" }, expected: "keep" },
    { name: "non-member plain file drops", file: { id: "other-agent", type: "agent" }, expected: "drop" },
    { name: "command matches via its cmd- selection form", file: { id: "kept-command", type: "command" }, expected: "keep" },
    { name: "protected member keeps plainly", file: { id: "kept-agent", type: "agent", protected: true }, expected: "keep" },
    { name: "protected non-member keeps with the missing marker", file: { id: "other-agent", type: "agent", protected: true }, expected: "keep-protected-missing" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(classifySelection(c.file, allow)).toBe(c.expected);
    });
  }

  it("null allowlist keeps everything", () => {
    expect(classifySelection({ id: "anything", type: "agent" }, null)).toBe("keep");
  });
});

describe("buildSelectionAllowlist degenerate shapes (test-2.8.6-b2-p4 #9)", () => {
  it("returns null for a non-object content value", () => {
    expect(buildSelectionAllowlist("full" as unknown as ContentSelection)).toBeNull();
  });

  it("returns null when items is a non-object", () => {
    const content = makeSelection({});
    (content as unknown as Record<string, unknown>).items = "everything";
    expect(buildSelectionAllowlist(content)).toBeNull();
  });

  it("filters non-string entries out of the per-class sets", () => {
    const content = makeSelection({ agents: ["real-agent"] });
    (content.items as unknown as Record<string, unknown>).rules = [42, null, "real-rule", { id: "x" }];
    const allow = buildSelectionAllowlist(content);
    expect(allow).not.toBeNull();
    expect(allow!.rules).toEqual(new Set(["real-rule"]));
    expect(allow!.agents).toEqual(new Set(["real-agent"]));
  });
});
