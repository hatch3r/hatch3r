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
import { buildContentIndex, type CatalogItem } from "../../content/index.js";
import { isFloorTag, filterByLanguages } from "../../content/tags.js";
import { applyCustomization, TYPE_TO_DIR } from "../../adapters/customization.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { resolveRepoConfig } from "../../workspace/resolve.js";
import { buildTagGroupedCustomContentChoices } from "../../cli/shared/customContentChoices.js";
import { DEFAULT_FEATURES } from "../../types.js";
import type { WorkspaceDefaults } from "../../workspace/types.js";
import type { ContentSelection } from "../../types.js";
import { TYPE_TO_SELECTION_KEY } from "../../content/index.js";

// D3-SA3.3-10: TYPE_TO_DIR is imported from `src/adapters/customization.ts` (its
// single source) instead of hand-mirrored, so this invariant automatically
// covers any type that becomes customizable there — the mirror could otherwise
// silently narrow the invariant. Only types in that map are customizable: the
// customization layer returns `skip: false` for any other type before reading
// .customize.yaml, so they cannot be disabled via the reverse channel this
// invariant defends.

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

// D16-2 (Cycle 11): the universal-floor invariant was enforced
// path-dependently — `resolveSelection` honoured it, but the three other
// content-reduction paths special-cased only `protected`, dropping the ~40+
// floor-tagged-unprotected items. After threading the shared
// `admitsUnconditionally` helper, this block asserts the invariant holds under
// (1) a language mismatch, (2) a workspace exclude, and (3) the custom-content
// picker — the structural counterpart to the single-path customization test
// above.
describe("floor-admission is path-independent (D16-2)", () => {
  function syntheticFloorItem(id: string): CatalogItem {
    return {
      id,
      type: "rule",
      description: `${id} — synthetic floor:security + lang:typescript rule`,
      tags: ["floor:security", "lang:typescript"],
      protected: false,
      relativePath: `rules/${id}.md`,
      source: "canonical",
    };
  }

  it("filterByLanguages keeps every floor item on a mismatched language (real corpus)", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);
    const floorItems = index.items.filter((item) => item.tags.some(isFloorTag));
    expect(floorItems.length).toBeGreaterThan(0);

    // Pick a language no canonical floor item is exclusively tagged for, then
    // assert ALL floor items survive — including any floor item carrying a
    // non-matching lang:* tag (the exact D2-4 fall-through).
    const kept = filterByLanguages(floorItems, ["python"]);
    expect(kept.length).toBe(floorItems.length);

    // Plus a synthetic floor:security + lang:typescript rule (guarantees the
    // language-mismatch arm is exercised even if the corpus has no such item).
    const synthetic = syntheticFloorItem("synthetic-floor-ts-rule");
    const keptSynthetic = filterByLanguages([synthetic], ["python"]);
    expect(keptSynthetic.map((i) => i.id)).toEqual(["synthetic-floor-ts-rule"]);
  });

  it("resolveRepoConfig refuses to exclude a floor item via a workspace override", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);
    const floorItems = index.items.filter((item) => item.tags.some(isFloorTag));
    expect(floorItems.length).toBeGreaterThan(0);
    const target = floorItems[0];

    // Mirror sync.ts: the not-excludable set is built from the
    // unconditional-admission predicate (protected OR floor:*).
    const unconditionalIds = new Set(
      index.items
        .filter((item) => item.protected === true || item.tags.some(isFloorTag))
        .map((item) => item.id),
    );

    const items: ContentSelection["items"] = {
      agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [],
    };
    const key = TYPE_TO_SELECTION_KEY[target.type];
    if (key) items[key].push(target.id);
    const baseContent: ContentSelection = {
      preset: "standard",
      projectType: "brownfield",
      teamSize: "solo",
      items,
    };
    const defaults: WorkspaceDefaults = {
      platform: "github",
      tools: ["claude"],
      features: { ...DEFAULT_FEATURES },
      mcp: { servers: [] },
      content: baseContent,
    };

    const result = resolveRepoConfig(
      defaults,
      { contentOverrides: { exclude: [target.id] } },
      unconditionalIds,
    );
    expect(result.contentIds.has(target.id)).toBe(true);
    expect(result.excludedContent).not.toContain(target.id);
  });

  it("custom-content picker locks every floor item checked + non-removable even when isChecked returns false (D10-13)", () => {
    // The custom picker is the deselect surface. With the floor affordance
    // threaded in, floor items are pre-checked AND disabled (non-removable)
    // regardless of the caller's isChecked, so a user starting from a
    // deselect-all state cannot drop a floor item — matching resolveSelection
    // Stage 1, which re-admits protected/floor items in the custom preset.
    const floorItem = syntheticFloorItem("synthetic-floor-rule");
    const protectedItem: CatalogItem = {
      id: "synthetic-protected-agent",
      type: "agent",
      description: "synthetic protected (non-floor-tagged) agent",
      tags: ["implementation"],
      protected: true,
      relativePath: "agents/synthetic-protected-agent.md",
      source: "canonical",
    };
    const nonFloorItem: CatalogItem = {
      id: "synthetic-plain-rule",
      type: "rule",
      description: "synthetic non-floor rule",
      tags: ["implementation"],
      protected: false,
      relativePath: "rules/synthetic-plain-rule.md",
      source: "canonical",
    };

    const choices = buildTagGroupedCustomContentChoices(
      [floorItem, protectedItem, nonFloorItem],
      () => false, // deselect-all baseline
    );
    const rows = choices.filter(
      (
        c,
      ): c is {
        name: string;
        value: string;
        checked: boolean;
        description?: string;
        disabled?: string;
      } => typeof c === "object" && c !== null && "value" in c,
    );
    const floorRow = rows.find((r) => r.value === "synthetic-floor-rule");
    const protectedRow = rows.find((r) => r.value === "synthetic-protected-agent");
    const plainRow = rows.find((r) => r.value === "synthetic-plain-rule");

    // Floor (tag-driven) row: pre-checked + locked with the lock label.
    expect(floorRow?.checked).toBe(true); // floor pre-checked despite isChecked=false
    expect(floorRow?.description).toMatch(/Floor/);
    expect(floorRow?.disabled).toBe("Floor — always included"); // non-removable

    // Protected (non-floor-tagged) row: admitsUnconditionally is also true, so
    // it gets the same lock — covers the `protected` arm of the predicate.
    expect(protectedRow?.checked).toBe(true);
    expect(protectedRow?.disabled).toBe("Floor — always included");

    // Optional row: honours the deselect baseline and stays toggleable.
    expect(plainRow?.checked).toBe(false); // non-floor honours the deselect baseline
    expect(plainRow?.disabled).toBeUndefined(); // optional rows are not locked
  });
});
