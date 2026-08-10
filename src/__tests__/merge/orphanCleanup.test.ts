import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";
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

  it("treats legacy Windows separators as the same repository-relative path", () => {
    expect(diffOrphanCandidates(
      [".cursor\\rules\\hatch3r-a.mdc"],
      [".cursor/rules/hatch3r-a.mdc"],
    )).toEqual([]);
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

  it.each([
    "C:\\tmp\\hatch3r-evil.mdc",
    "\\\\server\\share\\hatch3r-evil.mdc",
    ".cursor//rules/hatch3r-evil.mdc",
    ".cursor/./rules/hatch3r-evil.mdc",
    ".cursor/rules/hatch3r-evil\u0000.mdc",
  ])("rejects cross-platform or malformed recorded path %j", async (candidate) => {
    const entries = await sweepOrphansForAdapter("cursor", tempDir, [candidate], []);
    expect(entries).toEqual([{
      adapter: "cursor",
      path: candidate,
      removed: false,
      reason: "outside-adapter-root",
    }]);
  });

  it.runIf(platform() !== "win32")("skips an ancestor symlink and preserves its outside sentinel", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-symlink-outside-"));
    try {
      const rel = ".cursor/rules/hatch3r-sentinel.mdc";
      const sentinel = join(outsideDir, "rules", "hatch3r-sentinel.mdc");
      await mkdir(join(outsideDir, "rules"), { recursive: true });
      await writeFile(sentinel, "outside\n");
      await symlink(outsideDir, join(tempDir, ".cursor"));

      const entries = await sweepOrphansForAdapter("cursor", tempDir, [rel], []);
      expect(entries).toEqual([{
        adapter: "cursor",
        path: rel,
        removed: false,
        reason: "symlink-skipped",
      }]);
      expect(await readFile(sentinel, "utf-8")).toBe("outside\n");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
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

  // D10-SA10.6-01 (release/2.8.6): the skill-emission layout carries the
  // hatch3r marker on the PARENT directory (`skills/hatch3r-<id>/SKILL.md`),
  // not the file basename. Pre-fix, a deselected skill's SKILL.md failed the
  // basename filter forever and lingered as a permanent `! orphan` row.
  it("unlinks a SKILL.md whose parent directory basename is hatch3r-* and removes the emptied directory", async () => {
    const skillPath = ".claude/skills/hatch3r-old-skill/SKILL.md";
    await mkdir(join(tempDir, ".claude", "skills", "hatch3r-old-skill"), { recursive: true });
    await writeFile(join(tempDir, skillPath), "# old skill body\n");

    const entries = await sweepOrphansForAdapter("claude", tempDir, [skillPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(true);
    expect(entries[0].reason).toBe("unlinked");
    expect(await fileExists(join(tempDir, skillPath))).toBe(false);
    // F6: the emptied hatch3r-owned skill directory is removed too — no
    // lingering `skills/hatch3r-old-skill/` husk.
    expect(await fileExists(join(tempDir, ".claude", "skills", "hatch3r-old-skill"))).toBe(false);
    // The parent skills/ container itself is untouched.
    expect(await fileExists(join(tempDir, ".claude", "skills"))).toBe(true);
  });

  it("leaves the skill directory in place when it still contains user files (ENOTEMPTY, F6)", async () => {
    const skillPath = ".claude/skills/hatch3r-old-skill/SKILL.md";
    const userNote = join(tempDir, ".claude", "skills", "hatch3r-old-skill", "notes.md");
    await mkdir(join(tempDir, ".claude", "skills", "hatch3r-old-skill"), { recursive: true });
    await writeFile(join(tempDir, skillPath), "# old skill body\n");
    await writeFile(userNote, "# my notes about this skill\n");

    const entries = await sweepOrphansForAdapter("claude", tempDir, [skillPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("unlinked");
    // SKILL.md is gone, but the non-recursive rmdir fails ENOTEMPTY and the
    // directory with the user's file survives (best-effort, non-fatal).
    expect(await fileExists(join(tempDir, skillPath))).toBe(false);
    expect(await fileExists(userNote)).toBe(true);
  });

  it("still refuses a SKILL.md under a NON-hatch3r parent directory", async () => {
    // A user-authored skill directory inside an adapter root: the parent
    // carries no hatch3r marker, so the sweep must not touch it.
    const userSkillPath = ".claude/skills/my-own-skill/SKILL.md";
    await mkdir(join(tempDir, ".claude", "skills", "my-own-skill"), { recursive: true });
    await writeFile(join(tempDir, userSkillPath), "# user-authored skill\n");

    const entries = await sweepOrphansForAdapter("claude", tempDir, [userSkillPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("not-managed-basename");
    expect(await fileExists(join(tempDir, userSkillPath))).toBe(true);
  });

  it("unlinks an orphan carrying only the generated byte-0 frontmatter stub above the block", async () => {
    // The with-frontmatter emission shape (processCommandsWithFm /
    // processSkillsWithFmCliFiltered, release/2.6.0): a generated
    // `---\nname:\ndescription:\n---` stub precedes BEGIN. That prefix is
    // hatch3r-owned (isHealableManagedPrefix), so the sweep proceeds — the
    // pre-2.8.6 any-bytes veto refused every skill/command orphan forever.
    const cmdPath = ".claude/commands/hatch3r-old-command.md";
    await mkdir(join(tempDir, ".claude", "commands"), { recursive: true });
    await writeFile(
      join(tempDir, cmdPath),
      '---\nname: hatch3r-old-command\ndescription: "Old command"\n---\n\n<!-- HATCH3R:BEGIN -->\nbody\n<!-- HATCH3R:END -->\n',
    );

    const entries = await sweepOrphansForAdapter("claude", tempDir, [cmdPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(true);
    expect(entries[0].reason).toBe("unlinked");
    expect(await fileExists(join(tempDir, cmdPath))).toBe(false);
  });

  it("vetoes a healable-stub prefix combined with a user suffix (suffix-arm isolation, test-2.8.6-b2-p4 #1)", async () => {
    // The generated stub prefix is hatch3r-owned (would NOT veto on its own),
    // so the ONLY term that can refuse this candidate is the suffix arm —
    // user content after HATCH3R:END must veto unconditionally.
    const cmdPath = ".claude/commands/hatch3r-old-command.md";
    const bytes =
      '---\nname: x\ndescription: "y"\n---\n\n<!-- HATCH3R:BEGIN -->\nbody\n<!-- HATCH3R:END -->\n\n# my notes below\n';
    await mkdir(join(tempDir, ".claude", "commands"), { recursive: true });
    await writeFile(join(tempDir, cmdPath), bytes);

    const entries = await sweepOrphansForAdapter("claude", tempDir, [cmdPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("user-wrapped");
    // The file survives byte-for-byte.
    expect(await readFile(join(tempDir, cmdPath), "utf-8")).toBe(bytes);
  });

  it("SKILL.md sweep still honors the user-wrapped veto", async () => {
    // Managed parent dir, but the file wraps user content outside the
    // markers — filter 4 refuses regardless of the new basename recognition.
    const skillPath = ".claude/skills/hatch3r-old-skill/SKILL.md";
    await mkdir(join(tempDir, ".claude", "skills", "hatch3r-old-skill"), { recursive: true });
    await writeFile(
      join(tempDir, skillPath),
      "user notes above\n\n<!-- HATCH3R:BEGIN -->\nmanaged body\n<!-- HATCH3R:END -->\n",
    );

    const entries = await sweepOrphansForAdapter("claude", tempDir, [skillPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("user-wrapped");
    expect(await fileExists(join(tempDir, skillPath))).toBe(true);
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

describe("sweepOrphansForAdapter per-package containment (D14-5)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-pkg-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reclaims a removed package's per-package output when packageRoots is supplied", async () => {
    // Monorepo: a prior sync emitted root + per-package copies for two
    // packages. The user removes `packages/web` from the workspace globs, so
    // the next sync's current set keeps `packages/api/...` but drops
    // `packages/web/...`. With the package roots supplied, the dropped
    // per-package file passes containment and is unlinked.
    const rootPath = ".cursor/rules/50-hatch3r-testing.mdc";
    const apiPath = "packages/api/.cursor/rules/50-hatch3r-testing.mdc";
    const webPath = "packages/web/.cursor/rules/50-hatch3r-testing.mdc";
    for (const p of [rootPath, apiPath, webPath]) {
      await mkdir(join(tempDir, p.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(tempDir, p), "# hatch3r-managed\n");
    }

    // packages/web removed from the workspace -> only api + root remain current.
    const entries = await sweepOrphansForAdapter(
      "cursor",
      tempDir,
      [rootPath, apiPath, webPath],
      [rootPath, apiPath],
      ["packages/api"], // web is no longer a package root
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      adapter: "cursor",
      path: webPath,
      removed: true,
      reason: "unlinked",
    });
    expect(await fileExists(join(tempDir, webPath))).toBe(false);
    // Live files untouched.
    expect(await fileExists(join(tempDir, rootPath))).toBe(true);
    expect(await fileExists(join(tempDir, apiPath))).toBe(true);
  });

  it("classifies a per-package path as outside-adapter-root when packageRoots is omitted (back-compat)", async () => {
    // Without packageRoots, the containment check only accepts repo-root
    // adapter prefixes — a `packages/web/...` candidate is refused, so a
    // single-package caller (e.g. update.ts) never deletes a per-package file
    // it does not know about.
    const webPath = "packages/web/.cursor/rules/50-hatch3r-testing.mdc";
    await mkdir(join(tempDir, "packages/web/.cursor/rules"), { recursive: true });
    await writeFile(join(tempDir, webPath), "# hatch3r-managed\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [webPath], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("outside-adapter-root");
    expect(await fileExists(join(tempDir, webPath))).toBe(true);
  });

  it("reclaims a per-package rule for the claude adapter (directory-prefix root)", async () => {
    // The per-package variant of a directory prefix (`<pkg>/.claude/`) must be
    // accepted in containment so a removed package's claude rule is reclaimed.
    const webRule = "packages/web/.claude/rules/50-hatch3r-testing.md";
    await mkdir(join(tempDir, "packages/web/.claude/rules"), { recursive: true });
    await writeFile(join(tempDir, webRule), "# hatch3r-managed\n");

    const entries = await sweepOrphansForAdapter(
      "claude",
      tempDir,
      [webRule],
      [],
      ["packages/web"],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("unlinked");
    expect(await fileExists(join(tempDir, webRule))).toBe(false);
  });

  it("derives the package root from the candidate itself even when manifest.packages no longer lists it", async () => {
    // The removed-package case: the prior sync recorded the per-package path,
    // but the package is gone from `manifest.packages` (so the explicit
    // packageRoots arg here is empty). The root is recovered structurally from
    // the candidate path, so the orphan is still reclaimed.
    const webPath = "packages/legacy/.cursor/rules/50-hatch3r-old.mdc";
    await mkdir(join(tempDir, "packages/legacy/.cursor/rules"), { recursive: true });
    await writeFile(join(tempDir, webPath), "# hatch3r-managed\n");

    const entries = await sweepOrphansForAdapter("cursor", tempDir, [webPath], [], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("unlinked");
    expect(await fileExists(join(tempDir, webPath))).toBe(false);
  });

  it("refuses a candidate that escapes the repo root via .. even in per-package mode", async () => {
    // Path-traversal defense holds independently of the per-package widening:
    // a candidate whose normalised path leaves rootDir is rejected by the
    // repo-root containment guard before any prefix match, regardless of the
    // packageRoots argument or candidate-derived roots.
    const outsideDir = await mkdtemp(join(tmpdir(), "hatch3r-orphan-escape-"));
    const sentinel = join(outsideDir, ".cursor", "rules", "50-hatch3r-evil.mdc");
    await mkdir(join(outsideDir, ".cursor", "rules"), { recursive: true });
    await writeFile(sentinel, "outside-repo-root");

    try {
      const entries = await sweepOrphansForAdapter(
        "cursor",
        tempDir,
        [sentinel], // absolute path outside rootDir, but shaped like an adapter output
        [],
        ["packages/web"], // per-package mode opted in
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].removed).toBe(false);
      expect(entries[0].reason).toBe("outside-adapter-root");
      expect(await fileExists(sentinel)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("drops a malicious package root that escapes via .. without widening acceptance", async () => {
    // A tampered manifest.packages entry pointing outside the repo must not be
    // turned into an accepted prefix. We probe with a candidate that is NOT a
    // per-package adapter path (so candidate-derivation contributes nothing),
    // leaving the malicious explicit root as the only possible widening — which
    // is dropped, so the candidate stays outside any adapter root.
    const foreignPath = "src/hatch3r-foo.md";
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, foreignPath), "# foreign\n");

    const entries = await sweepOrphansForAdapter(
      "cursor",
      tempDir,
      [foreignPath],
      [],
      ["../../../etc/.cursor", "packages/../escape"], // unsafe -> dropped
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].removed).toBe(false);
    expect(entries[0].reason).toBe("outside-adapter-root");
    expect(await fileExists(join(tempDir, foreignPath))).toBe(true);
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
