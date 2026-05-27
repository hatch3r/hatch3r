// F3.5-F2 (Cycle 10 Wave 2, D3 Test Infrastructure): unit coverage for the
// orphan-file scan in `src/content/orphanScan.ts`.
//
// The module was effectively untested (import-time execution only — 0% when
// isolated, ~3.94% under the full suite) and the `src/content/**` aggregate
// threshold (85/70/85/85) masked the gap because the directory cleared the
// bar on the back of other modules. Orphan detection is a P4 Lean Coverage
// primitive (`scanOrphanFiles` backs `--clean-orphans`), so a silent
// regression in cleanup logic could either miss stale files or unlink the
// wrong ones. These tests exercise scan classification, the `cleanOrphans`
// unlink path + containment guard, symlink skipping, nested `hatch3r-*`
// canonical-by-association, and the `formatOrphanScanDiagnostic` renderer.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanOrphanFiles,
  formatOrphanScanDiagnostic,
} from "../../content/orphanScan.js";

const dirsToClean: string[] = [];

async function makeAgentsDir(): Promise<string> {
  // Layout an `.agents/` root inside a temp dir so the scan walks real FS.
  const root = await mkdtemp(join(tmpdir(), "hatch3r-orphan-scan-"));
  const agentsDir = join(root, ".agents");
  await mkdir(agentsDir, { recursive: true });
  dirsToClean.push(root);
  return agentsDir;
}

afterEach(async () => {
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("scanOrphanFiles", () => {
  // ── Empty / absent subtree ──────────────────────────────────────

  it("returns zero entries and zero errors for an empty .agents/", async () => {
    const agentsDir = await makeAgentsDir();
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("skips canonical subdirs that do not exist (ENOENT is not an error)", async () => {
    const agentsDir = await makeAgentsDir();
    // Only create one of the nine canonical subdirs; the other eight are absent.
    await mkdir(join(agentsDir, "agents"), { recursive: true });
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // ── Single orphan detection ─────────────────────────────────────

  it("flags a single non-canonical file as an orphan", async () => {
    const agentsDir = await makeAgentsDir();
    await mkdir(join(agentsDir, "agents"), { recursive: true });
    await writeFile(join(agentsDir, "agents", "notes.md"), "scratch\n");
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].relativePath).toBe(".agents/agents/notes.md");
    expect(result.entries[0].subdir).toBe("agents");
    expect(result.entries[0].removed).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it("does NOT flag canonical files (hatch3r- prefix or ALWAYS_CANONICAL_BASENAMES)", async () => {
    const agentsDir = await makeAgentsDir();
    await mkdir(join(agentsDir, "agents"), { recursive: true });
    await mkdir(join(agentsDir, "mcp"), { recursive: true });
    // Prefixed canonical artifact — accepted.
    await writeFile(join(agentsDir, "agents", "hatch3r-implementer.md"), "x\n");
    // ALWAYS_CANONICAL_BASENAMES member — accepted even without prefix.
    await writeFile(join(agentsDir, "mcp", "mcp.json"), "{}\n");
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toEqual([]);
  });

  // ── Nested orphans + canonical-by-association ───────────────────

  it("treats every file under a hatch3r-* directory as canonical-by-association", async () => {
    const agentsDir = await makeAgentsDir();
    const skillDir = join(agentsDir, "skills", "hatch3r-feature");
    await mkdir(skillDir, { recursive: true });
    // Inner filename has no prefix, but the skill directory is the canonical unit.
    await writeFile(join(skillDir, "SKILL.md"), "x\n");
    await writeFile(join(skillDir, "reference.md"), "y\n");
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toEqual([]);
  });

  it("flags nested orphans outside any hatch3r-* directory", async () => {
    const agentsDir = await makeAgentsDir();
    const nested = join(agentsDir, "rules", "subdir");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "scratch.md"), "z\n");
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].relativePath).toBe(".agents/rules/subdir/scratch.md");
    expect(result.entries[0].subdir).toBe("rules");
  });

  // ── Symlink handling (path-traversal defense) ───────────────────

  it("skips symlinks during the walk (does not flag or follow them)", async () => {
    const agentsDir = await makeAgentsDir();
    await mkdir(join(agentsDir, "commands"), { recursive: true });
    const realTarget = join(agentsDir, "commands", "hatch3r-real.md");
    await writeFile(realTarget, "real\n");
    // A symlink with a non-canonical name would be an orphan if followed —
    // the scan must skip it (isSymbolicLink guard).
    await symlink(realTarget, join(agentsDir, "commands", "evil-link.md"));
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toEqual([]);
  });

  // ── cleanOrphans unlink path ────────────────────────────────────

  it("unlinks orphans when cleanOrphans=true and marks them removed", async () => {
    const agentsDir = await makeAgentsDir();
    await mkdir(join(agentsDir, "hooks"), { recursive: true });
    const orphan = join(agentsDir, "hooks", "leftover.md");
    await writeFile(orphan, "old\n");
    const result = await scanOrphanFiles(agentsDir, { cleanOrphans: true });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].removed).toBe(true);
    expect(result.entries[0].error).toBeUndefined();
    // The file is gone from disk.
    await expect(stat(orphan)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves canonical files in place even when cleanOrphans=true", async () => {
    const agentsDir = await makeAgentsDir();
    await mkdir(join(agentsDir, "agents"), { recursive: true });
    const keep = join(agentsDir, "agents", "hatch3r-keep.md");
    await writeFile(keep, "keep\n");
    const result = await scanOrphanFiles(agentsDir, { cleanOrphans: true });
    expect(result.entries).toEqual([]);
    // Canonical file untouched.
    await expect(stat(keep)).resolves.toBeTruthy();
  });

  // ── Large-tree breadth ──────────────────────────────────────────

  it("walks a wide tree and flags every orphan across multiple subdirs", async () => {
    const agentsDir = await makeAgentsDir();
    const subdirs = ["agents", "commands", "rules", "skills", "hooks"];
    for (const sd of subdirs) {
      await mkdir(join(agentsDir, sd), { recursive: true });
      // One canonical + one orphan per subdir.
      await writeFile(join(agentsDir, sd, "hatch3r-canonical.md"), "c\n");
      await writeFile(join(agentsDir, sd, "orphan.md"), "o\n");
    }
    const result = await scanOrphanFiles(agentsDir);
    expect(result.entries).toHaveLength(subdirs.length);
    expect(result.entries.every((e) => e.relativePath.endsWith("/orphan.md"))).toBe(
      true,
    );
    expect(result.errors).toEqual([]);
  });
});

describe("formatOrphanScanDiagnostic", () => {
  it("returns null when there are no entries and no errors", () => {
    expect(formatOrphanScanDiagnostic({ entries: [], errors: [] })).toBeNull();
  });

  it("renders a detection summary with one line per orphan (cleanOrphans=false)", () => {
    const out = formatOrphanScanDiagnostic({
      entries: [
        { relativePath: ".agents/agents/notes.md", subdir: "agents", removed: false },
        { relativePath: ".agents/commands/scratch.md", subdir: "commands", removed: false },
      ],
      errors: [],
    });
    expect(out).toContain("Detected 2 orphan files");
    expect(out).toContain("orphan: .agents/agents/notes.md");
    expect(out).toContain("orphan: .agents/commands/scratch.md");
    expect(out).toContain("Run with --clean-orphans");
  });

  it("uses singular noun for exactly one orphan", () => {
    const out = formatOrphanScanDiagnostic({
      entries: [{ relativePath: ".agents/agents/notes.md", subdir: "agents", removed: false }],
      errors: [],
    });
    expect(out).toContain("Detected 1 orphan file ");
  });

  it("renders a cleaned summary with removed/kept tags (cleanOrphans=true)", () => {
    const out = formatOrphanScanDiagnostic(
      {
        entries: [
          { relativePath: ".agents/agents/removed.md", subdir: "agents", removed: true },
          {
            relativePath: ".agents/agents/failed.md",
            subdir: "agents",
            removed: false,
            error: "EPERM",
          },
          { relativePath: ".agents/agents/kept.md", subdir: "agents", removed: false },
        ],
        errors: [],
      },
      { cleanOrphans: true },
    );
    expect(out).toContain("Cleaned 1 of 3 orphan files");
    expect(out).toContain("removed: .agents/agents/removed.md");
    expect(out).toContain("kept (unlink failed: EPERM): .agents/agents/failed.md");
    expect(out).toContain("kept: .agents/agents/kept.md");
    // No detection hint in clean mode.
    expect(out).not.toContain("Run with --clean-orphans");
  });

  it("appends structural scan errors to the diagnostic", () => {
    const out = formatOrphanScanDiagnostic({
      entries: [],
      errors: ["orphan-scan: cannot stat agents/: EACCES"],
    });
    expect(out).toContain("orphan-scan: cannot stat agents/: EACCES");
  });
});
