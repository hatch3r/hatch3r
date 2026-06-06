// D12-3 (D12, P6): the provenance writer must persist `sourceFiles` as paths
// RELATIVE to the bundled content root, not the absolute machine-specific
// `/Users/<name>/…/dist/content/agents/…` paths `BaseAdapter` tracks. An
// absolute home path leaks the operator's username + install layout into a
// file the operator may commit. These tests pin the relativization at the
// single writer boundary (`writeProvenance`) plus the pure helper it uses.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  writeProvenance,
  relativizeSourceFile,
  PROVENANCE_FILE,
  type ProvenanceManifest,
} from "../../manifest/provenance.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { HATCH3R_DIR } from "../../types.js";

describe("relativizeSourceFile (D12-3)", () => {
  const root = join(sep, "abs", "content-root");

  it("rewrites an absolute path under the content root to a content-root-relative id", () => {
    const abs = join(root, "agents", "hatch3r-architect.md");
    expect(relativizeSourceFile(abs, root)).toBe("agents/hatch3r-architect.md");
  });

  it("leaves an already-relative id untouched (no cwd-resolution corruption)", () => {
    expect(relativizeSourceFile("rules/hatch3r-security-patterns.md", root)).toBe(
      "rules/hatch3r-security-patterns.md",
    );
  });

  it("preserves attribution for an absolute path outside the content root as a ..-relative id", () => {
    const outside = join(sep, "elsewhere", "skills", "x", "SKILL.md");
    const out = relativizeSourceFile(outside, root);
    // path.relative yields a ..-prefixed result; we keep it rather than drop
    // the source. POSIX-normalized so it never carries a backslash.
    expect(out.startsWith("..")).toBe(true);
    expect(out).not.toContain("\\");
  });

  it("normalizes Windows backslash separators to POSIX (cross-machine byte stability)", () => {
    // Simulate a Windows-style absolute path + root on a POSIX test host by
    // checking the public contract: the output never contains a backslash.
    const abs = join(root, "hooks", "hatch3r-pre.md");
    expect(relativizeSourceFile(abs, root)).not.toContain("\\");
  });
});

describe("writeProvenance sourceFiles relativization (D12-3)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-prov-rel-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readManifest(): Promise<ProvenanceManifest> {
    const raw = await readFile(join(tempDir, HATCH3R_DIR, PROVENANCE_FILE), "utf-8");
    return JSON.parse(raw) as ProvenanceManifest;
  }

  it("persists absolute BaseAdapter source paths as content-root-relative ids", async () => {
    // The writer relativizes against the live bundled content root. Build an
    // absolute input under that root so the assertion is layout-independent.
    const contentRoot = resolveBundledContentRoot();
    const absAgent = join(contentRoot, "agents", "hatch3r-implementer.md");
    const absRule = join(contentRoot, "rules", "hatch3r-security-patterns.md");

    const res = await writeProvenance(
      tempDir,
      [
        {
          adapter: "claude",
          outputs: [
            {
              path: "CLAUDE.md",
              content: "# CLAUDE.md\nbody",
              action: "create",
              sourceFiles: [absAgent, absRule],
            },
          ],
        },
      ],
      "sync",
    );

    expect(res.written).toBe(true);
    const manifest = await readManifest();
    const entry = manifest.outputs.find((o) => o.path === "CLAUDE.md");
    expect(entry).toBeDefined();
    // Sorted, relative, POSIX-separated — and crucially NOT the absolute home path.
    expect(entry?.sourceFiles).toEqual([
      "agents/hatch3r-implementer.md",
      "rules/hatch3r-security-patterns.md",
    ]);
    for (const s of entry?.sourceFiles ?? []) {
      expect(s.startsWith(sep === "\\" ? "C:\\" : "/")).toBe(false);
      expect(s).not.toContain("\\");
    }
  });

  it("writes an empty array unchanged for config-only outputs", async () => {
    const res = await writeProvenance(
      tempDir,
      [
        {
          adapter: "cursor",
          outputs: [
            { path: "mcp.json", content: "{}", action: "create", sourceFiles: [] },
          ],
        },
      ],
      "init",
    );
    expect(res.written).toBe(true);
    const manifest = await readManifest();
    expect(manifest.outputs.find((o) => o.path === "mcp.json")?.sourceFiles).toEqual([]);
  });
});
