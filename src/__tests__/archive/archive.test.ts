import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, access, rm, chmod, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import {
  archiveToolOutputs,
  collectToolFiles,
  removeManagedFilesForPaths,
  getManagedFilesForTool,
  pruneArchives,
  fileMatchesTool,
  TOOL_PATH_PREFIXES,
} from "../../archive/index.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { ARCHIVE_DIR, MANAGED_BLOCK_START, MANAGED_BLOCK_END, type HatchManifest, type Tool } from "../../types.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { CodexAdapter } from "../../adapters/codex.js";
import type { BaseAdapter } from "../../adapters/base.js";
import { resolveTestPath } from "../fixtures.js";

function wrapManaged(content: string): string {
  return `${MANAGED_BLOCK_START}\n${content}\n${MANAGED_BLOCK_END}`;
}

describe("archive", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeManifest(tools: string[]): HatchManifest {
    return createManifest({
      tools: tools as HatchManifest["tools"],
      mcpServers: [],
      features: { mcp: false },
    });
  }

  describe("archiveToolOutputs", () => {
    it("archives generated files to .hatch3r-archive/<tool>/<timestamp>/", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"),
        wrapManaged("managed content"),
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.archivedFiles.length).toBeGreaterThan(0);
      expect(result.archivedFiles).toContain(".cursor/rules/hatch3r-test.mdc");
      await expect(
        access(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc")),
      ).rejects.toThrow();

      const archiveDir = join(tempDir, ".hatch3r-archive", "cursor");
      await expect(access(archiveDir)).resolves.toBeUndefined();
    });

    it("detects custom content outside managed blocks and migrates to .hatch3r/", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });

      const fileContent = `---
description: My rule
alwaysApply: true
---

${MANAGED_BLOCK_START}
Managed content here
${MANAGED_BLOCK_END}

My custom additions that should be preserved`;

      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-my-rule.mdc"),
        fileContent,
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(1);
      expect(result.migrations[0].type).toBe("rules");
      expect(result.migrations[0].id).toBe("my-rule");

      const customizePath = join(tempDir, ".hatch3r", "rules", "my-rule.customize.md");
      const customizeContent = await readFile(customizePath, "utf-8");
      expect(customizeContent).toContain("My custom additions");
      expect(customizeContent).not.toContain("alwaysApply");
    });

    it("does not overwrite existing .hatch3r/ customization files", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await mkdir(join(tempDir, ".hatch3r", "rules"), { recursive: true });

      await writeFile(
        join(tempDir, ".hatch3r", "rules", "my-rule.customize.md"),
        "Existing customization\n",
      );

      const fileContent = `${MANAGED_BLOCK_START}\nManaged\n${MANAGED_BLOCK_END}\n\nNew custom content`;
      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-my-rule.mdc"),
        fileContent,
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(0);

      const existing = await readFile(
        join(tempDir, ".hatch3r", "rules", "my-rule.customize.md"),
        "utf-8",
      );
      expect(existing).toBe("Existing customization\n");
    });

    it("archives files without managed blocks without attempting migration", async () => {
      await mkdir(join(tempDir, ".cursor"), { recursive: true });

      await writeFile(
        join(tempDir, ".cursor", "mcp.json"),
        JSON.stringify({ mcpServers: {} }),
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(0);
      expect(result.archivedFiles).toContain(".cursor/mcp.json");
    });

    it("returns empty result for tool with no existing output files", async () => {
      const result = await archiveToolOutputs(tempDir, "claude");

      expect(result.archivedFiles).toHaveLength(0);
      expect(result.migrations).toHaveLength(0);
    });

    it("archives claude output including root-level files", async () => {
      await mkdir(join(tempDir, ".claude", "rules"), { recursive: true });

      await writeFile(join(tempDir, "CLAUDE.md"), wrapManaged("claude instructions"));
      await writeFile(join(tempDir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
      await writeFile(join(tempDir, ".claude", "rules", "hatch3r-test.md"), wrapManaged("rule content"));

      const result = await archiveToolOutputs(tempDir, "claude");

      expect(result.archivedFiles).toContain("CLAUDE.md");
      expect(result.archivedFiles).toContain(".mcp.json");
      expect(result.archivedFiles).toContain(".claude/rules/hatch3r-test.md");
    });

    it("archives only managed hatch3r skills from the shared Codex skill directory", async () => {
      const skillsRoot = join(tempDir, ".agents", "skills");
      const generated = join(skillsRoot, "hatch3r-plan", "SKILL.md");
      const userHatch3r = join(skillsRoot, "hatch3r-personal", "SKILL.md");
      const thirdParty = join(skillsRoot, "third-party", "SKILL.md");
      await mkdir(join(skillsRoot, "hatch3r-plan"), { recursive: true });
      await mkdir(join(skillsRoot, "hatch3r-personal"), { recursive: true });
      await mkdir(join(skillsRoot, "third-party"), { recursive: true });
      await writeFile(generated, wrapManaged("generated Codex skill"));
      await writeFile(userHatch3r, "---\nname: hatch3r-personal\n---\nUser content\n");
      await writeFile(thirdParty, "---\nname: third-party\n---\nThird-party content\n");

      const collected = await collectToolFiles(tempDir, "codex");
      expect(collected).toEqual([".agents/skills/hatch3r-plan/SKILL.md"]);

      const result = await archiveToolOutputs(tempDir, "codex");
      expect(result.archivedFiles).toEqual([".agents/skills/hatch3r-plan/SKILL.md"]);
      await expect(access(generated)).rejects.toThrow();
      await expect(access(userHatch3r)).resolves.toBeUndefined();
      await expect(access(thirdParty)).resolves.toBeUndefined();
    });

    it("matches only hatch3r-namespaced Codex skill output paths", () => {
      expect(fileMatchesTool(".agents/skills/hatch3r-plan/SKILL.md", "codex")).toBe(true);
      expect(fileMatchesTool(".agents/skills/personal/SKILL.md", "codex")).toBe(false);
    });

    it("migrates agent customizations from file path", async () => {
      await mkdir(join(tempDir, ".cursor", "agents"), { recursive: true });

      const fileContent = `---
name: hatch3r-reviewer
description: Code reviewer
---

${MANAGED_BLOCK_START}
Review code
${MANAGED_BLOCK_END}

Always check for SQL injection`;

      await writeFile(
        join(tempDir, ".cursor", "agents", "hatch3r-reviewer.md"),
        fileContent,
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(1);
      expect(result.migrations[0].type).toBe("agents");
      expect(result.migrations[0].id).toBe("reviewer");
    });
  });

  describe("removeManagedFilesForPaths", () => {
    it("removes specified paths from managedFiles", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = [
        ".cursor/rules/a.mdc",
        ".cursor/rules/b.mdc",
        "AGENTS.md",
      ];

      removeManagedFilesForPaths(manifest, [".cursor/rules/a.mdc", ".cursor/rules/b.mdc"]);

      expect(manifest.managedFiles).toEqual(["AGENTS.md"]);
    });

    it("handles empty paths array", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = ["file1.md", "file2.md"];

      removeManagedFilesForPaths(manifest, []);

      expect(manifest.managedFiles).toEqual(["file1.md", "file2.md"]);
    });

    it("handles paths not in managedFiles", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = ["file1.md"];

      removeManagedFilesForPaths(manifest, ["nonexistent.md"]);

      expect(manifest.managedFiles).toEqual(["file1.md"]);
    });
  });

  describe("getManagedFilesForTool", () => {
    it("returns cursor managed files", () => {
      const manifest = makeManifest(["cursor", "claude"]);
      manifest.managedFiles = [
        ".cursor/rules/test.mdc",
        ".cursor/mcp.json",
        "CLAUDE.md",
        ".claude/settings.json",
        "AGENTS.md",
      ];

      const result = getManagedFilesForTool(manifest, "cursor");

      expect(result).toEqual([".cursor/rules/test.mdc", ".cursor/mcp.json"]);
    });

    it("returns claude managed files including root-level files", () => {
      const manifest = makeManifest(["cursor", "claude"]);
      manifest.managedFiles = [
        ".cursor/rules/test.mdc",
        "CLAUDE.md",
        ".mcp.json",
        ".claude/settings.json",
        "AGENTS.md",
      ];

      const result = getManagedFilesForTool(manifest, "claude");

      expect(result).toEqual(["CLAUDE.md", ".mcp.json", ".claude/settings.json"]);
    });

    it("returns empty for tool with no managed files", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = ["AGENTS.md"];

      const result = getManagedFilesForTool(manifest, "copilot");

      expect(result).toEqual([]);
    });
  });

  // C7.5-W2B2-H10 (D3.4-F1): Coverage for `pruneArchives` -- the 24-line
  // rollback-on-corruption path in src/archive/index.ts:252-284. Archive is the
  // safety net for destructive sync operations; the prune function constrains
  // retention so a bug here could silently delete user snapshots. Previously
  // uncovered per coverage run (lines 252-284).
  describe("pruneArchives", () => {
    it("returns empty array when archive root does not exist (ENOENT path)", async () => {
      // No .hatch3r-archive directory -- readdir throws ENOENT which must be
      // swallowed and return []. Covers lines 256-261 ENOENT branch.
      const pruned = await pruneArchives(tempDir);
      expect(pruned).toEqual([]);
    });

    it("rethrows non-ENOENT errors from archive root readdir", async () => {
      // Replace `.hatch3r-archive` with a regular file so readdir fails with
      // ENOTDIR (or on some systems a different non-ENOENT code). The function
      // must rethrow -- covers the `throw err` branch at line 260.
      const archiveRootAsFile = join(tempDir, ARCHIVE_DIR);
      await writeFile(archiveRootAsFile, "not a directory");

      await expect(pruneArchives(tempDir)).rejects.toMatchObject({
        code: expect.stringMatching(/ENOTDIR|EACCES|EPERM/),
      });
    });

    it("returns empty when archive root exists but contains no tool directories", async () => {
      // Archive root exists but is empty -- the for-loop never executes and
      // pruned stays []. Confirms the happy short-circuit path.
      await mkdir(join(tempDir, ARCHIVE_DIR), { recursive: true });

      const pruned = await pruneArchives(tempDir);
      expect(pruned).toEqual([]);
    });

    it("skips stray files under archive root (non-directory entries)", async () => {
      // The orchestrator should only prune directories. A stray file at
      // .hatch3r-archive/<name> must be left alone -- covers the
      // `if (!s.isDirectory()) continue;` branch at line 268.
      const archiveRoot = join(tempDir, ARCHIVE_DIR);
      await mkdir(archiveRoot, { recursive: true });
      const strayFile = join(archiveRoot, "README.md");
      await writeFile(strayFile, "accidental file in archive root");

      const pruned = await pruneArchives(tempDir);

      expect(pruned).toEqual([]);
      // Stray file still present
      await expect(access(strayFile)).resolves.toBeUndefined();
    });

    it.skipIf(platform() === "win32")(
      "continues past tool directories whose entries cannot be read",
      async () => {
        // Create a dangling symlink as a tool-dir entry. readdir of the archive
        // root lists the symlink name; stat follows the link and fails with
        // ENOENT -- caught and the loop continues. Another valid tool dir
        // alongside must still be pruned. Covers the `catch { continue; }`
        // branch at lines 270-272. POSIX-only because Windows symlink
        // semantics require elevated privileges.
        const archiveRoot = join(tempDir, ARCHIVE_DIR);
        await mkdir(archiveRoot, { recursive: true });
        // Broken symlink pointing at a path that does not exist.
        await symlink(
          join(tempDir, "does-not-exist"),
          join(archiveRoot, "cursor"),
        );
        // A real tool dir with 6 timestamped entries -> 1 must be pruned.
        const copilotPath = join(archiveRoot, "copilot");
        await mkdir(copilotPath, { recursive: true });
        for (let i = 0; i < 6; i++) {
          await mkdir(
            join(copilotPath, `2026-04-${String(10 + i).padStart(2, "0")}T00-00-00-000Z`),
            { recursive: true },
          );
        }

        const pruned = await pruneArchives(tempDir);

        // cursor skipped silently (stat threw). copilot pruned its oldest.
        expect(pruned).toHaveLength(1);
        expect(pruned[0]).toBe("copilot/2026-04-10T00-00-00-000Z");
      },
    );

    it("keeps all entries when count equals the retention limit", async () => {
      // Boundary test: exactly 5 entries -> nothing pruned. Guards against an
      // off-by-one at `entries.slice(MAX_ARCHIVE_ENTRIES)`.
      const toolPath = join(tempDir, ARCHIVE_DIR, "cursor");
      await mkdir(toolPath, { recursive: true });
      for (let i = 0; i < 5; i++) {
        await mkdir(join(toolPath, `2026-04-${String(10 + i).padStart(2, "0")}T00-00-00-000Z`), {
          recursive: true,
        });
      }

      const pruned = await pruneArchives(tempDir);

      expect(pruned).toEqual([]);
      const remaining = await readdir(toolPath);
      expect(remaining).toHaveLength(5);
    });

    it("keeps all entries when count is below the retention limit", async () => {
      const toolPath = join(tempDir, ARCHIVE_DIR, "cursor");
      await mkdir(toolPath, { recursive: true });
      for (let i = 0; i < 3; i++) {
        await mkdir(join(toolPath, `2026-04-${String(10 + i).padStart(2, "0")}T00-00-00-000Z`), {
          recursive: true,
        });
      }

      const pruned = await pruneArchives(tempDir);

      expect(pruned).toEqual([]);
    });

    it("prunes oldest entries beyond the retention limit, keeping newest 5", async () => {
      // 7 ISO-timestamped entries -> 2 oldest (by lexical string compare since
      // timestamps are ISO) are pruned. Covers lines 274-281 (sort + slice loop).
      const toolPath = join(tempDir, ARCHIVE_DIR, "cursor");
      await mkdir(toolPath, { recursive: true });
      const timestamps = [
        "2026-04-10T00-00-00-000Z",
        "2026-04-11T00-00-00-000Z",
        "2026-04-12T00-00-00-000Z",
        "2026-04-13T00-00-00-000Z",
        "2026-04-14T00-00-00-000Z",
        "2026-04-15T00-00-00-000Z",
        "2026-04-16T00-00-00-000Z",
      ];
      for (const ts of timestamps) {
        const entryDir = join(toolPath, ts);
        await mkdir(entryDir, { recursive: true });
        // Put a file inside so rm recursive:true is actually exercised.
        await writeFile(join(entryDir, "snapshot.txt"), `archived at ${ts}`);
      }

      const pruned = await pruneArchives(tempDir);

      // 2 oldest pruned.
      expect(pruned).toHaveLength(2);
      expect(pruned).toContain("cursor/2026-04-10T00-00-00-000Z");
      expect(pruned).toContain("cursor/2026-04-11T00-00-00-000Z");

      // 5 newest remain, verified by directory listing.
      const remaining = await readdir(toolPath);
      expect(remaining.sort()).toEqual([
        "2026-04-12T00-00-00-000Z",
        "2026-04-13T00-00-00-000Z",
        "2026-04-14T00-00-00-000Z",
        "2026-04-15T00-00-00-000Z",
        "2026-04-16T00-00-00-000Z",
      ]);
    });

    it("prunes independently per tool directory", async () => {
      // Two tools with different entry counts in the same archive root.
      // Confirms the outer for-loop iterates over every tool directory.
      const cursorPath = join(tempDir, ARCHIVE_DIR, "cursor");
      const copilotPath = join(tempDir, ARCHIVE_DIR, "copilot");
      await mkdir(cursorPath, { recursive: true });
      await mkdir(copilotPath, { recursive: true });

      // cursor: 6 entries -> 1 pruned
      for (let i = 0; i < 6; i++) {
        await mkdir(join(cursorPath, `2026-04-${String(10 + i).padStart(2, "0")}T00-00-00-000Z`), {
          recursive: true,
        });
      }
      // copilot: 4 entries -> 0 pruned
      for (let i = 0; i < 4; i++) {
        await mkdir(join(copilotPath, `2026-04-${String(10 + i).padStart(2, "0")}T00-00-00-000Z`), {
          recursive: true,
        });
      }

      const pruned = await pruneArchives(tempDir);

      expect(pruned).toHaveLength(1);
      expect(pruned[0]).toBe("cursor/2026-04-10T00-00-00-000Z");

      const cursorRemaining = await readdir(cursorPath);
      expect(cursorRemaining).toHaveLength(5);
      const copilotRemaining = await readdir(copilotPath);
      expect(copilotRemaining).toHaveLength(4);
    });

    it("prunes directories with nested content (exercises rm recursive:true)", async () => {
      // Pruned entries often contain a deep directory tree mirroring the
      // original layout. Confirms rm(..., { recursive: true, force: true })
      // at line 279 removes nested files without throwing.
      const toolPath = join(tempDir, ARCHIVE_DIR, "claude");
      await mkdir(toolPath, { recursive: true });
      for (let i = 0; i < 7; i++) {
        const ts = `2026-04-${String(10 + i).padStart(2, "0")}T00-00-00-000Z`;
        const nested = join(toolPath, ts, ".claude", "rules");
        await mkdir(nested, { recursive: true });
        await writeFile(join(nested, "hatch3r-rule.md"), "rule body");
        await writeFile(join(toolPath, ts, "CLAUDE.md"), "instructions");
      }

      const pruned = await pruneArchives(tempDir);

      expect(pruned).toHaveLength(2);
      const remaining = await readdir(toolPath);
      expect(remaining).toHaveLength(5);
      // Confirm pruned directories are actually gone (no partial removal).
      for (const p of pruned) {
        const relPath = p.replace("claude/", "");
        await expect(access(join(toolPath, relPath))).rejects.toThrow();
      }
    });
  });

  // Supplementary coverage for two small uncovered branches identified in the
  // same coverage report that drove C7.5-W2B2-H10.
  describe("archiveToolOutputs -- edge branches", () => {
    it("archives a file whose path does not match any customizable pattern", async () => {
      // File lives inside a tool prefix but its path does not match any of
      // PATH_PATTERNS (rules/agents/skills/commands). The file has content
      // outside the managed block so `customContent.length > 0` is true,
      // forcing parseOutputPath to run; since no pattern matches, it returns
      // null, no migration is emitted, and the file is still archived.
      // Covers the `return null` branch at line 67 of parseOutputPath.
      await mkdir(join(tempDir, ".cursor"), { recursive: true });
      const unusualFile = join(tempDir, ".cursor", "custom-config.yml");
      const fileContent = `${MANAGED_BLOCK_START}\ncursor config\n${MANAGED_BLOCK_END}\n\nuser-authored tail`;
      await writeFile(unusualFile, fileContent);

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations).toHaveLength(0);
      expect(result.archivedFiles).toContain(".cursor/custom-config.yml");
    });

    it.skipIf(platform() === "win32")(
      "continues past files that become unreadable during iteration",
      async () => {
        // Force readFile to fail for one file via chmod 0000. The archive
        // function must swallow the error and keep processing -- covers the
        // `try/catch { continue; }` at lines 146-151. POSIX-only because
        // Windows chmod semantics differ.
        if (process.getuid && process.getuid() === 0) {
          // Running as root bypasses permission checks; skip under sudo.
          return;
        }
        await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
        const unreadable = join(tempDir, ".cursor", "rules", "hatch3r-locked.mdc");
        const readable = join(tempDir, ".cursor", "rules", "hatch3r-ok.mdc");
        await writeFile(unreadable, wrapManaged("locked"));
        await writeFile(readable, wrapManaged("readable"));
        await chmod(unreadable, 0o000);

        try {
          const result = await archiveToolOutputs(tempDir, "cursor");
          // The readable file still gets archived; the locked file is skipped
          // silently without throwing.
          expect(result.archivedFiles).toContain(".cursor/rules/hatch3r-ok.mdc");
        } finally {
          // Restore permissions so afterEach rm cleanup succeeds.
          await chmod(unreadable, 0o644);
        }
      },
    );

    // D2-M14 (D2 Medium, Cycle 10 Wave 3 rollover): the post-copy validation
    // now compares SHA-256 of source and destination, catching the
    // same-size-different-content bypass (disk corruption, concurrent writer,
    // network FS inconsistency). The size-match-content-divergent scenario
    // is hard to provoke from a normal cp(), so this test directly forces
    // the destination's bytes to differ from the source after cp returns
    // and confirms the next archive run on the SAME paths still validates
    // correctly via the hash check. The negative-path (mismatch detected)
    // is exercised via a `vi.spyOn` against `node:fs/promises.cp` that
    // overwrites the destination with same-length corrupted bytes.
    it("verifies content via SHA-256 (passthrough on equal bytes)", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-d2m14-ok.mdc"),
        wrapManaged("identical-content"),
      );
      // Normal happy path: cp produces byte-identical destination, hash
      // matches, file is archived and source removed.
      const result = await archiveToolOutputs(tempDir, "cursor");
      expect(result.archivedFiles).toContain(".cursor/rules/hatch3r-d2m14-ok.mdc");
      await expect(
        access(join(tempDir, ".cursor", "rules", "hatch3r-d2m14-ok.mdc")),
      ).rejects.toThrow();
    });

    // D3-16 (Cycle 11 Wave 3): the negative paths — size-mismatch and
    // same-size-content-mismatch — ARE covered, in the sibling file
    // archive.integrityBranches.test.ts. The earlier "vitest cannot mock
    // node:fs/promises" note was incorrect: `vi.doMock("node:fs/promises",
    // importOriginal)` overrides only `cp` (the same pattern used by
    // safeWrite.lockBranches.test.ts and orphanCleanup.errorBranches.test.ts),
    // forcing a corrupted destination so both integrity throws fire and each
    // asserts the source file survives (the gated `rm` never runs).
  });
});

// D10-11 (Cycle 11 Wave 2, D10, P1): structural invariant — every path an
// adapter emits must be covered by that adapter's TOOL_PATH_PREFIXES entry.
// The leak the finding reports: copilot.ts:442 emits `.github/checks/{name}.md`
// but TOOL_PATH_PREFIXES.copilot omitted `.github/checks/`, so config
// tool-removal (which archives via collectToolFiles -> these prefixes) left the
// 6 canonical checks/ outputs orphaned on disk. This generates each real
// adapter against the repo's own canonical content root (source dirs agents/,
// skills/, rules/, commands/, hooks/, checks/ — feature-complete by
// DEFAULT_FEATURES) and asserts fileMatchesTool() — the exact coverage
// predicate collectToolFiles uses — returns true for every output path. A
// future adapter that emits a new top-level dir without a matching prefix
// fails here instead of silently leaking files past removal.
describe("TOOL_PATH_PREFIXES output coverage (D10-11)", () => {
  // Repo root: src/__tests__/archive/ -> up 3 -> package root, which holds the
  // canonical source content dirs (agents/, checks/, skills/, ...). Build-state
  // independent (does not depend on dist/ or resolveBundledContentRoot caching).
  const repoRoot = resolveTestPath(import.meta.url, "../../../");

  const adapters: Array<{ tool: Tool; adapter: BaseAdapter }> = [
    { tool: "cursor", adapter: new CursorAdapter() },
    { tool: "claude", adapter: new ClaudeAdapter() },
    { tool: "copilot", adapter: new CopilotAdapter() },
    { tool: "codex", adapter: new CodexAdapter() },
  ];

  for (const { tool, adapter } of adapters) {
    it(`every ${tool} output path is covered by TOOL_PATH_PREFIXES.${tool}`, async () => {
      // mcpServers populated so the MCP-config output path materializes; all
      // content features default ON via DEFAULT_FEATURES so every emit branch
      // (agents/skills/rules/commands/hooks/checks) runs.
      const manifest = createManifest({
        tools: [tool],
        mcpServers: ["github"],
      });
      const outputs = await adapter.generate(repoRoot, manifest);
      expect(outputs.length).toBeGreaterThan(0);

      const uncovered = outputs
        .map((o) => o.path)
        .filter((p) => !fileMatchesTool(p, tool));
      expect(
        uncovered,
        `${tool} emits output path(s) absent from TOOL_PATH_PREFIXES.${tool} ` +
          `(${TOOL_PATH_PREFIXES[tool].join(", ")}); these files would orphan on ` +
          `tool removal. Add the missing prefix(es): ${uncovered.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("emits the .github/checks/ outputs the prefix now covers (copilot)", async () => {
    // Direct regression pin for the exact leak: copilot must emit at least one
    // `.github/checks/` output AND that output must be covered. Guards against a
    // future refactor that drops the checks emission (making the coverage test
    // vacuously pass) or re-drops the prefix.
    const manifest = createManifest({ tools: ["copilot"], mcpServers: ["github"] });
    const outputs = await new CopilotAdapter().generate(repoRoot, manifest);
    const checkOutputs = outputs.filter((o) => o.path.startsWith(".github/checks/"));
    expect(checkOutputs.length).toBeGreaterThan(0);
    for (const o of checkOutputs) {
      expect(fileMatchesTool(o.path, "copilot")).toBe(true);
    }
  });
});

// D10-33 (Cycle 11 Wave 3, D10, P1): the structural gap behind the D10-11 leak
// expressed at top-level-output-root granularity. The D10-11 block above checks
// each FULL output path against fileMatchesTool. This block reduces each
// adapter's outputs to their distinct top-level roots (the first path segment +
// "/" for nested files, or the bare path for a root-level file) and asserts
// every root maps to a TOOL_PATH_PREFIXES entry. The hand-maintained prefix
// table has no machine link to adapter doGenerate() output dirs; this invariant
// supplies that link at the granularity an orphan-on-removal actually occurs (a
// whole output root with no prefix), so a future adapter introducing a new
// top-level root without a prefix fails here instead of silently leaking the
// entire directory past tool removal.
describe("TOOL_PATH_PREFIXES top-level-root coverage (D10-33)", () => {
  const repoRoot = resolveTestPath(import.meta.url, "../../../");

  const adapters: Array<{ tool: Tool; adapter: BaseAdapter }> = [
    { tool: "cursor", adapter: new CursorAdapter() },
    { tool: "claude", adapter: new ClaudeAdapter() },
    { tool: "copilot", adapter: new CopilotAdapter() },
    { tool: "codex", adapter: new CodexAdapter() },
  ];

  // The top-level output root of a path: the first segment plus "/" when the
  // path is nested (".github/agents/x.md" -> ".github/"), or the whole path for
  // a root-level file ("CLAUDE.md" -> "CLAUDE.md").
  function topLevelRoot(path: string): string {
    const slash = path.indexOf("/");
    return slash === -1 ? path : path.slice(0, slash + 1);
  }

  // A root is covered when some prefix in the tool's entry begins with it (a
  // directory prefix nested under the root, e.g. ".github/checks/" covers
  // ".github/") or equals it exactly (a root-file prefix like "CLAUDE.md").
  function rootIsCovered(root: string, tool: Tool): boolean {
    return TOOL_PATH_PREFIXES[tool].some(
      (prefix) => prefix === root || prefix.startsWith(root),
    );
  }

  for (const { tool, adapter } of adapters) {
    it(`every ${tool} top-level output root has a TOOL_PATH_PREFIXES.${tool} entry`, async () => {
      const manifest = createManifest({ tools: [tool], mcpServers: ["github"] });
      const outputs = await adapter.generate(repoRoot, manifest);
      expect(outputs.length).toBeGreaterThan(0);

      const roots = [...new Set(outputs.map((o) => topLevelRoot(o.path)))];
      const uncoveredRoots = roots.filter((r) => !rootIsCovered(r, tool));
      expect(
        uncoveredRoots,
        `${tool} emits top-level output root(s) absent from ` +
          `TOOL_PATH_PREFIXES.${tool} (${TOOL_PATH_PREFIXES[tool].join(", ")}); ` +
          `the entire root would orphan on tool removal. Add a covering ` +
          `prefix for: ${uncoveredRoots.join(", ")}`,
      ).toEqual([]);
    });
  }
});

// D10-SA10.5-01 (Cycle 12 Wave 2, D10, P1): the REVERSE direction of D10-11.
// D10-11 asserts emitted ⊆ prefix-covered (no hatch3r output escapes removal).
// This block pins the other side of the same prefix table: Copilot's directory
// prefixes (`.github/prompts/`, `.github/instructions/`, ...) are shared
// user-authoring surfaces per VS Code's docs (users create prompt files there
// via `/create-prompt`), so a directory-prefix sweep removes MORE than hatch3r
// generated. The consent/undo alignment (D2-SA2.7-01, config.ts) derives both
// the removal preview's surplus disclosure and the pre-deletion rollback
// snapshot from `collectToolFiles` — the same set `archiveToolOutputs`
// deletes. These tests pin that parity contract at the archive layer so a
// future divergence (a filter added to one side but not the other) fails here
// instead of silently re-opening the undisclosed-deletion gap:
//   1. `collectToolFiles` DISCLOSES co-tenant user files (they are visible to
//      the preview + snapshot sources).
//   2. `archiveToolOutputs` removes exactly the disclosed set — nothing is
//      deleted that the preview/snapshot could not have covered.
//   3. A user file with no managed block gets NO `.customize.md` migration —
//      the disclosed snapshot/archive is its only recovery path, which is why
//      the disclosure parity is load-bearing user-data protection.
describe("tool removal co-tenant disclosure parity (D10-SA10.5-01)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cotenant-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const USER_FILE = ".github/prompts/refactor.prompt.md";
  const HATCH3R_FILE = ".github/prompts/hatch3r-plan.prompt.md";

  async function seedCoTenantDir(): Promise<void> {
    await mkdir(join(tempDir, ".github", "prompts"), { recursive: true });
    // User-authored: no HATCH3R managed block, non-hatch3r basename.
    await writeFile(
      join(tempDir, USER_FILE),
      "My hand-written VS Code prompt — not generated by hatch3r.\n",
    );
    // hatch3r-generated sibling in the same directory.
    await writeFile(
      join(tempDir, HATCH3R_FILE),
      `${MANAGED_BLOCK_START}\ngenerated prompt\n${MANAGED_BLOCK_END}\n`,
    );
  }

  it("collectToolFiles discloses user-authored co-tenant files under copilot dir prefixes", async () => {
    await seedCoTenantDir();
    const collected = await collectToolFiles(tempDir, "copilot");
    expect(collected).toContain(USER_FILE);
    expect(collected).toContain(HATCH3R_FILE);
  });

  it("archiveToolOutputs removes exactly the collectToolFiles set (preview/snapshot parity)", async () => {
    await seedCoTenantDir();
    const disclosed = await collectToolFiles(tempDir, "copilot");

    const result = await archiveToolOutputs(tempDir, "copilot");

    // Parity: the removal set equals the disclosure set — the D2-SA2.7-01
    // preview warning and rollback snapshot are sourced from `disclosed`, so
    // any file removed but not disclosed would be an unconsented deletion.
    expect([...result.archivedFiles].sort()).toEqual([...disclosed].sort());

    // The user file is gone from its original location...
    await expect(access(join(tempDir, USER_FILE))).rejects.toThrow();
    // ...and its bytes are preserved verbatim in the archive entry.
    const copilotArchive = join(tempDir, ARCHIVE_DIR, "copilot");
    const entries = await readdir(copilotArchive);
    expect(entries.length).toBe(1);
    const archivedUserFile = join(copilotArchive, entries[0], USER_FILE);
    expect(await readFile(archivedUserFile, "utf-8")).toBe(
      "My hand-written VS Code prompt — not generated by hatch3r.\n",
    );
  });

  it("gives the swept user file no .customize.md migration (managed-block gate)", async () => {
    await seedCoTenantDir();
    const result = await archiveToolOutputs(tempDir, "copilot");

    // The migration channel is gated on hasManagedBlock; a user file without
    // markers is swept with NO `.hatch3r/**.customize.md` copy — recovery is
    // only the disclosed snapshot/archive from the parity test above.
    expect(result.migrations).toEqual([]);
    await expect(access(join(tempDir, ".hatch3r"))).rejects.toThrow();
  });
});
