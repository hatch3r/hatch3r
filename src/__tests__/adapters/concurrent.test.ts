/**
 * C9-M12 (D2 Medium, Cycle 10 Wave 3 rollover): regression tests for the
 * concurrent `generate()` warnings interleave that previously corrupted
 * diagnostics when two callers shared a cached adapter instance.
 *
 * Pre-fix, `getAdapter()` returned a module-level cached singleton per tool
 * and `BaseAdapter.warnings` lived on `this`. Two concurrent `generate()`
 * calls would each reset `this.warnings = []` at entry, then push warnings
 * from `readCanonicalFiles` / `applyCustomization` into the SAME array —
 * producing interleaved warnings (call A's warnings arriving in call B's
 * return value and vice versa) and non-deterministic counts depending on
 * filesystem scheduling.
 *
 * Post-fix, `getAdapter()` constructs a fresh instance on every call, so two
 * concurrent calls operate on disjoint `BaseAdapter` instances and their
 * warnings arrays are partitioned by ownership. This test exercises that
 * invariant by:
 *   1. Asserting `getAdapter(tool)` returns DIFFERENT instances on successive
 *      calls (no module-level cache).
 *   2. Running two `generate()` calls in parallel against fixture content
 *      that DOES generate warnings (intentional TYPE_MISMATCH-triggering
 *      fixture), then checking that each call's adapter.warnings is
 *      consistent with the warnings array on the AdapterOutput[] return
 *      shape and does not include cross-talk from the other invocation.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAdapter } from "../../adapters/index.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { Tool } from "../../types.js";

describe("adapter concurrent generate() isolation (C9-M12)", () => {
  it("getAdapter returns a fresh instance on each call (no module-level cache)", () => {
    const a = getAdapter("claude");
    const b = getAdapter("claude");
    expect(a).not.toBe(b);
  });

  it("getAdapter returns fresh instances for every supported tool", () => {
    const tools: Tool[] = ["cursor", "claude", "copilot"];
    for (const tool of tools) {
      const a = getAdapter(tool);
      const b = getAdapter(tool);
      expect(a).not.toBe(b);
    }
  });

  it("concurrent generate() calls do not interleave warnings between adapters", async () => {
    // Build a canonical fixture root that intentionally produces a
    // TYPE_MISMATCH warning so every generate() pass has a non-empty
    // warnings channel to mix up. Two callers point at the SAME fixture
    // root via DIFFERENT adapter instances; we then assert each instance's
    // warning count matches the deterministic single-call baseline.
    const root = await mkdtemp(join(tmpdir(), "hatch3r-c9m12-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      // Author one agent whose `id` is a number — parseFrontmatter() emits a
      // TYPE_MISMATCH on the id field per canonical.ts L300+ (C7.5-W2B2-H8).
      // The mismatch surfaces on the warnings channel of every generate()
      // that reads this directory.
      await writeFile(
        join(root, "agents", "bad-id.md"),
        "---\nid: 123\ntype: agent\ndescription: triggers TYPE_MISMATCH on id\ntags: [floor:security]\n---\n\nBody.\n",
      );
      await mkdir(join(root, "skills"), { recursive: true });
      await mkdir(join(root, "rules"), { recursive: true });

      // Baseline: single sequential call gives us the expected warning count.
      const baselineAdapter = getAdapter("claude");
      const baselineManifest = createManifest({ tools: ["claude"] });
      await baselineAdapter.generate(root, baselineManifest);
      const baselineCount = baselineAdapter.warnings.filter((w) =>
        w.includes("TYPE_MISMATCH"),
      ).length;
      // Sanity: the fixture should fire at least one TYPE_MISMATCH so the
      // concurrency assertion below is not vacuous.
      expect(baselineCount).toBeGreaterThan(0);

      // Parallel: two FRESH adapter instances run generate() at the same
      // time against the same fixture. Each instance MUST observe the same
      // baseline count — neither inflated by cross-talk from the other.
      const a = getAdapter("claude");
      const b = getAdapter("claude");
      expect(a).not.toBe(b);
      const m = createManifest({ tools: ["claude"] });
      await Promise.all([a.generate(root, m), b.generate(root, m)]);
      const aCount = a.warnings.filter((w) => w.includes("TYPE_MISMATCH")).length;
      const bCount = b.warnings.filter((w) => w.includes("TYPE_MISMATCH")).length;
      expect(aCount).toBe(baselineCount);
      expect(bCount).toBe(baselineCount);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
