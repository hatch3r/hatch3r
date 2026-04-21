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

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
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
      await adapter.generate(FIXTURES_DIR, manifest, "minimal");
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
      await adapter.generate(FIXTURES_DIR, manifest, "minimal");
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
      await adapter.generate(FIXTURES_DIR, manifest, "standard");
      expect(isMin).toBe(false);
    });

    it("stripMinimal removes HTML comments", async () => {
      let stripped = "";
      class StripCheck extends BaseAdapter {
        readonly name = "strip-check";
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
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
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
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
        protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
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
});
