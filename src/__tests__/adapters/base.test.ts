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
});
