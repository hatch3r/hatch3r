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
});
