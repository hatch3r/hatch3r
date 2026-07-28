// release/2.8.5 (BUG-2 definitive + BUG-1 major) regression pin — published
// tarball layout. The npm package ships canonical content under
// `dist/content/` ONLY (no root `agents/`), but `init`/`config` used to build
// the content index against `findPackageRoot(__dirname)` — the PACKAGE root.
// Every per-directory read ENOENT'd, `buildContentIndex` swallowed each one,
// and the silently empty index cascaded into empty preset counts, an empty
// `manifest.content.items` for EVERY preset, and a crashing Custom picker.
//
// This suite reproduces the published layout in a temp dir and pins both
// halves of the fix:
//   1. Indexing the package root (the old bug shape) now FAILS LOUD with an
//      actionable FS_ERROR instead of resolving an empty index.
//   2. Indexing `dist/content` (what `resolveBundledContentRoot()` returns for
//      a production install) succeeds and resolves a non-empty selection.
// No test previously built the index against the dist/content layout — the
// whole suite ran from the dev checkout, whose root `agents/` masked the bug.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildContentIndex, getAllContentIds, resolveSelection } from "../../content/index.js";
import { getPreset } from "../../content/presets.js";

const md = (meta: Record<string, unknown>, body = "# body\n"): string => {
  const lines = Object.entries(meta).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${v}`,
  );
  return `---\n${lines.join("\n")}\n---\n${body}`;
};

describe("published npm layout (dist/content) — release/2.8.5 BUG-2 regression", () => {
  let pkgRoot: string;
  let distContent: string;

  beforeEach(async () => {
    pkgRoot = await mkdtemp(join(tmpdir(), "hatch3r-published-"));
    distContent = join(pkgRoot, "dist", "content");
    // Mimic the published tarball: package.json + dist/ only — NO root
    // agents/skills/rules (verified against `npm pack` output in the 2.8.5
    // diagnosis: 341 files, none at the root content paths).
    await writeFile(join(pkgRoot, "package.json"), JSON.stringify({ name: "hatch3r" }));
    await mkdir(join(distContent, "agents"), { recursive: true });
    await mkdir(join(distContent, "skills", "hatch3r-fixture-skill"), { recursive: true });
    await mkdir(join(distContent, "rules"), { recursive: true });
    await writeFile(
      join(distContent, "agents", "hatch3r-fixture-agent.md"),
      md({
        id: "hatch3r-fixture-agent",
        type: "agent",
        description: "Fixture agent for the published-layout index regression",
        tags: ["orchestration"],
        protected: true,
      }),
    );
    await writeFile(
      join(distContent, "skills", "hatch3r-fixture-skill", "SKILL.md"),
      md({
        id: "hatch3r-fixture-skill",
        type: "skill",
        description: "Fixture skill for the published-layout index regression",
        tags: ["implementation"],
      }),
    );
    await writeFile(
      join(distContent, "rules", "hatch3r-fixture-rule.md"),
      md({
        id: "hatch3r-fixture-rule",
        type: "rule",
        description: "Fixture rule for the published-layout index regression",
        tags: ["floor:security"],
      }),
    );
  });

  afterEach(async () => {
    await rm(pkgRoot, { recursive: true, force: true });
  });

  it("indexing the PACKAGE ROOT (the pre-2.8.5 bug shape) fails loud instead of resolving empty", async () => {
    await expect(buildContentIndex(pkgRoot)).rejects.toMatchObject({
      errorCode: "FS_ERROR",
      message: expect.stringContaining("Content index is empty"),
    });
  });

  it("indexing dist/content (the resolveBundledContentRoot target) finds the corpus", async () => {
    const index = await buildContentIndex(distContent);
    expect(index.items.map((i) => i.id).sort()).toEqual([
      "hatch3r-fixture-agent",
      "hatch3r-fixture-rule",
      "hatch3r-fixture-skill",
    ]);
  });

  it("a standard-preset selection resolved against the dist/content index is non-empty (BUG-1 symptom)", async () => {
    const index = await buildContentIndex(distContent);
    const selection = resolveSelection(getPreset("standard"), "brownfield", "solo", index);
    const ids = getAllContentIds(selection);
    // protected agent + floor rule + capability-matched skill all admit.
    expect(ids.has("hatch3r-fixture-agent")).toBe(true);
    expect(ids.has("hatch3r-fixture-rule")).toBe(true);
    expect(ids.has("hatch3r-fixture-skill")).toBe(true);
  });
});
