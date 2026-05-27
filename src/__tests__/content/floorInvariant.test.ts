// F2.3-C1 (Cycle 10 Wave 1, D2 Adapter Infrastructure): structural-invariant
// property test for the floor-admission invariant declared in
// `governance/CONSTITUTION.md` §2 P5 ("Floor admission" row).
//
// Invariant (verbatim from CONSTITUTION §2 P5):
//   "every non-custom preset admits every item tagged `floor:security`,
//    `floor:ui-ux`, or `floor:protocol` unconditionally"
//
// The selection layer (`src/content/index.ts::resolveSelection` stage 2)
// already enforces this via `item.tags.some(isFloorTag)`. F2.3-C1 discovered
// that the customization-emission layer (`applyCustomizationImpl` in
// `src/adapters/customization.ts:425-440,469-471`) provided a reverse channel:
// `.customize.yaml` with `enabled: false` silently dropped 15+ floor-tagged
// unprotected artifacts from adapter output, defeating the invariant.
//
// This property test scans every floor-tagged canonical artifact in the
// bundled content corpus and asserts that `applyCustomization` with
// `enabled: false` returns `skip: false` — meaning the customization layer
// cannot bypass the floor admission. It is the structural counterpart to
// the per-floor-class unit tests in
// `src/__tests__/adapters/customization.test.ts`.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildContentIndex } from "../../content/index.js";
import { isFloorTag } from "../../content/tags.js";
import { applyCustomization } from "../../adapters/customization.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";

// Mirror of the module-private TYPE_TO_DIR in `src/adapters/customization.ts`.
// Only these types are customizable (the customization layer returns
// `skip: false` for any other type before reading .customize.yaml, so they
// cannot be disabled via the reverse channel this invariant defends).
const TYPE_TO_DIR: Record<string, string> = {
  agent: "agents",
  skill: "skills",
  command: "commands",
  rule: "rules",
};

describe("floor-admission structural invariant (F2.3-C1)", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  async function setup(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "hatch3r-floor-invariant-"));
    tempDirs.push(dir);
    return dir;
  }

  it("every floor-tagged canonical artifact rejects enabled: false (skip remains false)", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);

    // Collect every canonical item carrying any `floor:*` tag.
    const floorItems = index.items.filter((item) => item.tags.some(isFloorTag));
    // Guardrail: if this assertion ever drops to zero the corpus has been
    // gutted of floor tags — the invariant is meaningless to assert and the
    // test should be re-checked rather than silently passing.
    expect(floorItems.length).toBeGreaterThan(0);

    const violations: Array<{ id: string; type: string; reason: string }> = [];

    for (const item of floorItems) {
      // Only canonical types covered by TYPE_TO_DIR (the customization layer
      // exits early for unsupported types — those cannot be disabled via
      // .customize.yaml regardless and are out of the invariant's scope).
      const dirName = TYPE_TO_DIR[item.type];
      if (!dirName) continue;

      const projectRoot = await setup();
      const customizeDir = join(projectRoot, ".hatch3r", dirName);
      await mkdir(customizeDir, { recursive: true });
      await writeFile(
        join(customizeDir, `${item.id}.customize.yaml`),
        "enabled: false",
        "utf-8",
      );

      // Synthesize a minimal CanonicalFile from the catalog item — we don't
      // need the real source bytes, only the structural fields that drive
      // the customization decision: id, type, tags, protected.
      const result = await applyCustomization(projectRoot, {
        id: item.id,
        type: item.type,
        description: item.description ?? "",
        protected: item.protected,
        tags: [...item.tags],
        content: "",
        rawContent: "",
        sourcePath: "/test/synthetic",
      });

      if (result.skip !== false) {
        violations.push({
          id: item.id,
          type: item.type,
          reason: `skip=${result.skip} (expected false; invariant breached)`,
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it("non-floor non-protected items still honour enabled: false (negative control)", async () => {
    // Negative control: F2.3-C1 must not over-apply. Items without a floor
    // tag and without `protected: true` continue to be droppable via
    // `enabled: false`. Without this guardrail, the test above would be
    // vacuously satisfied by a customization layer that ignored
    // `enabled: false` for every artifact.
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "synthetic-non-floor-agent.customize.yaml"),
      "enabled: false",
      "utf-8",
    );

    const result = await applyCustomization(projectRoot, {
      id: "synthetic-non-floor-agent",
      type: "agent",
      description: "Synthetic non-floor non-protected agent",
      protected: false,
      tags: ["review", "ui"],
      content: "Body",
      rawContent: "---\nid: synthetic-non-floor-agent\n---\nBody",
      sourcePath: "/test/synthetic",
    });

    expect(result.skip).toBe(true);
  });
});
