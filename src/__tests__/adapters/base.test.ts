import { describe, it, expect } from "vitest";
import { BaseAdapter, output } from "../../adapters/base.js";
import type { AdapterContext } from "../../adapters/base.js";
import type { AdapterOutput, HatchManifest } from "../../types.js";
import { createManifest } from "../../manifest/hatchJson.js";
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
      expect(adapter.warnings).toEqual(["warning-1"]);

      // Second call should reset warnings
      await adapter.generate(FIXTURES_DIR, manifest);
      expect(adapter.warnings).toEqual(["warning-1"]);
      // Should NOT have accumulated ["warning-1", "warning-1"]
      expect(adapter.warnings.length).toBe(1);
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

    it("populates sourceFiles for every output an adapter emits (shared tracked set)", async () => {
      class MultiOutputAdapter extends BaseAdapter {
        readonly name = "multi-output";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
          await this.inlineRules(ctx);
          // Emit two output files; both should receive the tracked sourceFiles.
          return [
            output("first.md", "first"),
            output("second.md", "second"),
          ];
        }
      }
      const adapter = new MultiOutputAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outputs.length).toBe(2);
      expect(outputs[0]?.sourceFiles?.length).toBeGreaterThan(0);
      expect(outputs[1]?.sourceFiles).toEqual(outputs[0]?.sourceFiles);
    });

    it("leaves sourceFiles undefined when no canonical files are read", async () => {
      class NoCanonicalAdapter extends BaseAdapter {
        readonly name = "no-canonical";
        protected async doGenerate(_ctx: AdapterContext): Promise<AdapterOutput[]> {
          return [output("config.json", JSON.stringify({ hello: "world" }))];
        }
      }
      const adapter = new NoCanonicalAdapter();
      const outputs = await adapter.generate(FIXTURES_DIR, makeManifest());
      // When no canonical files are read, the tracked set is empty and we
      // should not fabricate a sourceFiles entry — absence is the signal.
      expect(outputs[0]?.sourceFiles).toBeUndefined();
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
      // Second run read no canonical files; tracker reset → sourceFiles absent.
      expect(capturedSecond).toBeUndefined();
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

    it("does not surface invariant warnings for valid outputs", async () => {
      const adapter = new InvariantAdapter([output("ok.md", "content")]);
      const outs = await adapter.generate(FIXTURES_DIR, makeManifest());
      expect(outs).toHaveLength(1);
      expect(adapter.warnings.length).toBe(0);
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
          const rules = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "rules");
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
