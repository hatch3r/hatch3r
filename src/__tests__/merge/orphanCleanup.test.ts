import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sweepOrphansForAdapter,
  diffOrphanCandidates,
  formatOrphanCleanupDiagnostic,
} from "../../merge/orphanCleanup.js";

/**
 * Unit tests for the orphan-cleanup module.
 *
 * These exercise the safety filters (basename check, adapter-root
 * containment, user-wrapped managed block detection, path traversal)
 * in isolation from the sync pipeline. End-to-end sync behaviour is
 * covered in `sync.test.ts`.
 */

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    // Missing path is the expected outcome for this probe.
    void err;
    return false;
  }
}

describe("diffOrphanCandidates", () => {
  it("returns empty when previousPaths is undefined (no history)", () => {
    expect(diffOrphanCandidates(undefined, [".cursor/rules/50-hatch3r-testing.mdc"])).toEqual([]);
  });

  it("returns empty when previousPaths is empty", () => {
    expect(diffOrphanCandidates([], [".cursor/rules/50-hatch3r-testing.mdc"])).toEqual([]);
  });

  it("returns paths in previous but not in current", () => {
    const previous = [
      ".cursor/rules/hatch3r-testing.mdc",
      ".cursor/rules/hatch3r-security.mdc",
    ];
    const current = [
      ".cursor/rules/50-hatch3r-testing.mdc",
      ".cursor/rules/30-hatch3r-security.mdc",
    ];
    expect(diffOrphanCandidates(previous, current)).toEqual([
      ".cursor/rules/hatch3r-testing.mdc",
      ".cursor/rules/hatch3r-security.mdc",
    ]);
  });

  it("preserves only paths absent from current", () => {
    const previous = [
      ".cursor/rules/hatch3r-a.mdc",
      ".cursor/rules/hatch3r-b.mdc",
      ".cursor/rules/hatch3r-c.mdc",
    ];
    const current = [".cursor/rules/hatch3r-a.mdc", ".cursor/rules/hatch3r-c.mdc"];
    expect(diffOrphanCandidates(previous, current)).toEqual([".cursor/rules/hatch3r-b.mdc"]);
  });
});

describe("sweepOrphansForAdapter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty when previousPaths is undefined (first-run, no history)", async () => {
    const entries = await sweepOrphansForAdapter(
      "cursor",
      tempDir,
      undefined,
      [".cursor/rules/50-hatch3r-testing.mdc"],
    );
    expect(entries).toEqual([]);
  });

  it("returns empty when previousPaths is empty", async () => {
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [], [
      ".cursor/rules/50-hatch3r-testing.mdc",
    ]);
    expect(entries).toEqual([]);
  });

  it("unlinks a pre-B3 rule file no longer emitted by the current adapter", async () => {
    // Migration case from the task spec: manifest records `hatch3r-testing.mdc`
    // but current adapter emits `50-hatch3r-testing.mdc`. Assert old unlinked.
    const oldPath = ".cursor/rules/hatch3r-testing.mdc";
    const newPath = ".cursor/rules/50-hatch3r-testing.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, oldPath), "# old rule content (hatch3r-managed)\n");
    await writeFile(join(tempDir, newPath), "# new rule content\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [oldPath], [newPath]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      adapter: "cursor",
      path: oldPath,
      removed: true,
      reason: "unlinked",
    });
    expect(await fileExists(join(tempDir, oldPath))).toBe(false);
    expect(await fileExists(join(tempDir, newPath))).toBe(true);
  });

  it("partial case: unlinks all 5 orphans when adapter emits 5 different paths", async () => {
    // Manifest records 5 rules, adapter emits 5 rules at different paths.
    // Assert all 5 old unlinked, 5 new exist, manifest conceptually updated.
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    const oldPaths = [
      ".cursor/rules/hatch3r-a.mdc",
      ".cursor/rules/hatch3r-b.mdc",
      ".cursor/rules/hatch3r-c.mdc",
      ".cursor/rules/hatch3r-d.mdc",
      ".cursor/rules/hatch3r-e.mdc",
    ];
    const newPaths = [
      ".cursor/rules/10-hatch3r-a.mdc",
      ".cursor/rules/30-hatch3r-b.mdc",
      ".cursor/rules/50-hatch3r-c.mdc",
      ".cursor/rules/50-hatch3r-d.mdc",
      ".cursor/rules/70-hatch3r-e.mdc",
    ];
    for (const p of oldPaths) await writeFile(join(tempDir, p), "# old\n");
    for (const p of newPaths) await writeFile(join(tempDir, p), "# new\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, oldPaths, newPaths);

    const removed = entries.filter((e) => e.removed);
    expect(removed).toHaveLength(5);
    for (const p of oldPaths) expect(await fileExists(join(tempDir, p))).toBe(false);
    for (const p of newPaths) expect(await fileExists(join(tempDir, p))).toBe(true);
  });

  it("skips a file the user has edited to wrap a HATCH3R:BEGIN/END block with custom content", async () => {
    // Foreign-file case: the file on disk has been edited by the user
    // (wrapped in HATCH3R:BEGIN/END with custom content between). Assert
    // the file is NOT unlinked — we do not own the surrounding content.
    const oldPath = ".cursor/rules/hatch3r-testing.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    const wrapped =
      "# My team's custom preamble\n\n" +
      "<!-- HATCH3R:BEGIN -->\n" +
      "# rule body\n" +
      "<!-- HATCH3R:END -->\n\n" +
      "# My team's custom footer\n";
    await writeFile(join(tempDir, oldPath), wrapped);

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [oldPath], [
      ".cursor/rules/50-hatch3r-testing.mdc",
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("user-wrapped");
    // File still on disk
    expect(await fileExists(join(tempDir, oldPath))).toBe(true);
    const still = await readFile(join(tempDir, oldPath), "utf-8");
    expect(still).toBe(wrapped);
  });

  it("proceeds to unlink when the managed block exists but nothing else in the file does", async () => {
    // Edge case alongside user-wrapped: a file that is entirely a managed
    // block (no user content outside) is ours and may be deleted.
    const oldPath = ".cursor/rules/hatch3r-fully-managed.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    const fully =
      "<!-- HATCH3R:BEGIN -->\n# rule body\n<!-- HATCH3R:END -->\n";
    await writeFile(join(tempDir, oldPath), fully);

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [oldPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(true);
    expect(entries[0].reason).toBe("unlinked");
    expect(await fileExists(join(tempDir, oldPath))).toBe(false);
  });

  it("refuses path-traversal: absolute path outside rootDir is skipped", async () => {
    // Path-traversal defense: manifest claims a path outside any known
    // adapter root. Assert refusal to unlink.
    //
    // Use a path in the system tmp dir that definitely exists, so if the
    // refusal is broken the test would actually risk unlinking it. Instead
    // we use a sentinel file we own under a *different* tempdir so even if
    // the defense breaks there's no real-world harm.
    const outsideDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-outside-"));
    const outsideFile = join(outsideDir, "sentinel.mdc");
    await writeFile(outsideFile, "outside-rootDir");

    try {
      const entries = await sweepOrphansForAdapter(
        "cursor",
        tempDir,
        [outsideFile], // absolute path
        [],
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].removed).toBe(false);
      expect(entries[0].reason).toBe("outside-adapter-root");
      // Sentinel file still present
      expect(await fileExists(outsideFile)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses path-traversal: ../../../secret relative path is skipped", async () => {
    const entries = await sweepOrphansForAdapter(
      "cursor",
      tempDir,
      ["../../../secret"],
      [],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("outside-adapter-root");
  });

  it("refuses paths outside known adapter roots (e.g. src/foo.md under rootDir)", async () => {
    // The path is inside rootDir but NOT under any declared adapter output
    // prefix. The basename filter would pass (`hatch3r-foo.md`), but the
    // root-containment filter rejects it.
    await mkdir(join(tempDir, "src"), { recursive: true });
    const foreignPath = "src/hatch3r-foo.md";
    await writeFile(join(tempDir, foreignPath), "# foreign\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [foreignPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("outside-adapter-root");
    expect(await fileExists(join(tempDir, foreignPath))).toBe(true);
  });

  it("skips a path whose basename does not match hatch3r-* or NN-hatch3r-*", async () => {
    // The manifest claims ownership of a non-hatch3r-prefixed file. We
    // refuse — the basename filter is a soundness check.
    const badPath = ".cursor/rules/user-file.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, badPath), "# user file\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [badPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("not-managed-basename");
    expect(await fileExists(join(tempDir, badPath))).toBe(true);
  });

  it("treats missing files as already-cleaned (no-op, reason 'missing')", async () => {
    // Manifest records a file but it has already been manually removed.
    // No error — just mark missing and move on.
    const entries = await sweepOrphansForAdapter(
      "cursor",
      tempDir,
      [".cursor/rules/hatch3r-gone.mdc"],
      [],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("missing");
  });

  it("accepts NN-hatch3r-* basename as a valid managed output", async () => {
    // Prior run emitted `50-hatch3r-old.mdc`; current run emits a
    // differently-numbered or differently-named file. The old numeric-
    // prefixed file should still be unlinked.
    const oldPath = ".cursor/rules/50-hatch3r-old.mdc";
    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(tempDir, oldPath), "# old\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [oldPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(true);
    expect(await fileExists(join(tempDir, oldPath))).toBe(false);
  });

  it("works across the supported adapter output roots (.cursor, .claude, .github/instructions)", async () => {
    // W1-C (release/1.9.0): only claude, cursor, copilot adapters remain.
    // Each case is isolated to its own adapter call to verify the
    // root-containment filter accepts each adapter's primary output root.
    const cases: Array<{ adapter: string; path: string }> = [
      { adapter: "cursor", path: ".cursor/rules/50-hatch3r-test.mdc" },
      { adapter: "claude", path: ".claude/rules/50-hatch3r-test.md" },
      { adapter: "copilot", path: ".github/instructions/50-hatch3r-test.md" },
    ];
    for (const { adapter, path } of cases) {
      const sub = path.split("/").slice(0, -1).join("/");
      await mkdir(join(tempDir, sub), { recursive: true });
      await writeFile(join(tempDir, path), "# pre-B3 stray\n");

      const entries = await sweepOrphansForAdapter(adapter, tempDir, [path], []);
      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe("unlinked");
      expect(await fileExists(join(tempDir, path))).toBe(false);
    }
  });
});

describe("sweepOrphansForAdapter error paths", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-err-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("marks a candidate as read-failed when readFile throws (e.g. target is a directory, not a file)", async () => {
    // Create a directory at the path the manifest claims is a file.
    // readFile() on a directory throws EISDIR, which trips the wrapCheck
    // error branch and produces a `read-failed` entry.
    const badPath = ".cursor/rules/hatch3r-isdir.mdc";
    await mkdir(join(tempDir, badPath), { recursive: true });

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [badPath], []);
    expect(entries).toHaveLength(1);
    // readFile on the directory will succeed? Actually on Node some platforms
    // return the content on directories. If so, the fallback is that there's
    // no managed block text, which proceeds to unlink — which would then fail
    // with EISDIR, reaching the unlink-failed branch instead. Either path
    // produces a non-removed entry with an error message.
    expect(entries[0].removed).toBe(false);
    expect(["read-failed", "unlink-failed"]).toContain(entries[0].reason);
    expect(entries[0].error).toBeTruthy();
  });

  it("does not throw when the adapter root directory does not exist yet", async () => {
    // Manifest claims a file under .cursor/rules/ but that dir has never
    // been created. Should mark as `missing`, not crash.
    const entries = await sweepOrphansForAdapter(
      "cursor",
      tempDir,
      [".cursor/rules/hatch3r-never-existed.mdc"],
      [],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("missing");
  });
});

describe("formatOrphanCleanupDiagnostic", () => {
  it("returns null for an empty list", () => {
    expect(formatOrphanCleanupDiagnostic([])).toBeNull();
  });

  it("returns null when every entry is just 'missing' (uneventful)", () => {
    expect(
      formatOrphanCleanupDiagnostic([
        { adapter: "cursor", path: ".cursor/rules/hatch3r-a.mdc", removed: false, reason: "missing" },
      ]),
    ).toBeNull();
  });

  it("mentions each unlinked file", () => {
    const msg = formatOrphanCleanupDiagnostic([
      { adapter: "cursor", path: ".cursor/rules/hatch3r-a.mdc", removed: true, reason: "unlinked" },
      { adapter: "windsurf", path: ".windsurf/rules/hatch3r-b.md", removed: true, reason: "unlinked" },
    ]);
    expect(msg).toContain("Unlinked 2 orphaned adapter output(s)");
    expect(msg).toContain(".cursor/rules/hatch3r-a.mdc (cursor)");
    expect(msg).toContain(".windsurf/rules/hatch3r-b.md (windsurf)");
  });

  it("mentions safety skips with reason", () => {
    const msg = formatOrphanCleanupDiagnostic([
      { adapter: "cursor", path: ".cursor/rules/hatch3r-x.mdc", removed: false, reason: "user-wrapped" },
    ]);
    expect(msg).toContain("Skipped 1 orphan candidate(s) for safety");
    expect(msg).toContain("user-wrapped");
  });

  it("mentions unlink failures with the error message", () => {
    const msg = formatOrphanCleanupDiagnostic([
      {
        adapter: "cursor",
        path: ".cursor/rules/hatch3r-x.mdc",
        removed: false,
        reason: "unlink-failed",
        error: "EACCES: permission denied",
      },
    ]);
    expect(msg).toContain("Failed to remove 1 orphan candidate(s)");
    expect(msg).toContain("EACCES");
  });
});
