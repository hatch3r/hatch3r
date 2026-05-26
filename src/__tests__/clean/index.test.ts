import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Mock external dependencies before dynamic imports ─────────

vi.mock("../../manifest/hatchJson.js", () => ({
  readManifest: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../workspace/detect.js", () => ({
  detectWorkspaceContext: vi.fn().mockResolvedValue({ type: "standalone" }),
}));

// DO NOT mock ../../merge/managedBlocks.js — we need real hasManagedBlock / extractCustomContent

// ── Import mocked modules ─────────────────────────────────────

import { readManifest } from "../../manifest/hatchJson.js";
import { detectWorkspaceContext } from "../../workspace/detect.js";

// ── Import module under test ──────────────────────────────────

import {
  inventoryArtifacts,
  executeClean,
  backupLearnings,
  restoreLearnings,
  type CleanInventory,
} from "../../clean/index.js";
import { HATCH3R_DIR } from "../../types.js";

// ── Constants ─────────────────────────────────────────────────

const ARCHIVE_DIR = ".hatch3r-archive";
const WORKTREE_INCLUDE_FILE = ".worktreeinclude";

// ── Helpers ───────────────────────────────────────────────────

async function createTestRepo(tempDir: string): Promise<void> {
  // .hatch3r/ with learnings (Wave 6 relocation)
  await mkdir(join(tempDir, HATCH3R_DIR, "learnings"), { recursive: true });
  await mkdir(join(tempDir, HATCH3R_DIR, "handoffs"), { recursive: true });

  // .hatch3r/hatch.json (Wave 6 manifest relocation)
  await writeFile(
    join(tempDir, HATCH3R_DIR, "hatch.json"),
    JSON.stringify(
      {
        version: "3.0.0",
        hatch3rVersion: "1.9.0",
        owner: "test",
        repo: "test",
        namespace: "test",
        project: "test",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true, handoffs: true },
        mcp: { servers: [] },
        managedFiles: [".cursor/rules/hatch3r-test.mdc"],
      },
      null,
      2,
    ),
  );

  // .hatch3r-archive/
  await mkdir(join(tempDir, ARCHIVE_DIR), { recursive: true });
  await writeFile(join(tempDir, ARCHIVE_DIR, "old-backup.json"), "{}");

  // .worktreeinclude
  await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), `${HATCH3R_DIR}/\n`);

  // .env.mcp
  await writeFile(join(tempDir, ".env.mcp"), "SECRET_KEY=abc123");

  // Adapter output: cursor (matches manifest.managedFiles).
  await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
  await writeFile(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"), "cursor content");

  // AGENTS.md with managed block
  const agentsMd = [
    "# My Project Notes",
    "",
    "<!-- HATCH3R:BEGIN -->",
    "Managed content here",
    "<!-- HATCH3R:END -->",
    "",
    "# User section below",
  ].join("\n");
  await writeFile(join(tempDir, "AGENTS.md"), agentsMd);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    // Missing path is an expected branch for this probe.
    void err;
    return false;
  }
}

// ── Tests ─────────────────────────────────────────────────────

describe("clean/index", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-clean-"));
    vi.mocked(readManifest).mockResolvedValue(null);
    vi.mocked(detectWorkspaceContext).mockResolvedValue({ type: "standalone" });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── inventoryArtifacts ────────────────────────────────────

  describe("inventoryArtifacts", () => {
    it("returns empty inventory when directory has no hatch3r files", async () => {
      const inv = await inventoryArtifacts(tempDir);

      expect(inv.adapterFiles).toEqual([]);
      expect(inv.manifestPresent).toBe(false);
      expect(inv.archiveDir).toBe(false);
      expect(inv.hatch3rDir).toBe(false);
      expect(inv.worktreeInclude).toBe(false);
      expect(inv.envMcp).toBe(false);
      expect(inv.manifest).toBeNull();
    });

    it("detects .hatch3r/ directory (Wave 6 footprint)", async () => {
      await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.hatch3rDir).toBe(true);
    });

    it("detects .hatch3r/hatch.json manifest", async () => {
      await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
      await writeFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "{}");

      const inv = await inventoryArtifacts(tempDir);
      expect(inv.manifestPresent).toBe(true);
    });

    it("detects adapter output files", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await writeFile(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"), "content");

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.adapterFiles.length).toBeGreaterThan(0);
      const hasCursorFile = inv.adapterFiles.some((f) => f.includes(".cursor/"));
      expect(hasCursorFile).toBe(true);
    });

    it("detects .hatch3r-archive/ directory", async () => {
      await mkdir(join(tempDir, ARCHIVE_DIR), { recursive: true });

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.archiveDir).toBe(true);
    });

    it("detects .worktreeinclude", async () => {
      await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), `${HATCH3R_DIR}/\n`);

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.worktreeInclude).toBe(true);
    });

    it("detects .env.mcp", async () => {
      await writeFile(join(tempDir, ".env.mcp"), "SECRET=val");

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.envMcp).toBe(true);
    });
  });

  // ── executeClean ──────────────────────────────────────────

  describe("executeClean", () => {
    it("removes adapter output files", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      const result = await executeClean(tempDir, inv, false);

      expect(result.removed.length).toBeGreaterThan(0);
      // Cursor file should be gone
      expect(await exists(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"))).toBe(false);
    });

    it("removes .hatch3r/hatch.json but preserves .hatch3r/ subdirectories", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      await executeClean(tempDir, inv, false);

      // The manifest itself is removed
      expect(await exists(join(tempDir, HATCH3R_DIR, "hatch.json"))).toBe(false);
      // But the surrounding `.hatch3r/` user-state is preserved
      expect(await exists(join(tempDir, HATCH3R_DIR, "learnings"))).toBe(true);
      expect(await exists(join(tempDir, HATCH3R_DIR, "handoffs"))).toBe(true);
    });

    it("removes .worktreeinclude", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      await executeClean(tempDir, inv, false);

      expect(await exists(join(tempDir, WORKTREE_INCLUDE_FILE))).toBe(false);
    });

    it("removes .hatch3r-archive/", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      await executeClean(tempDir, inv, false);

      expect(await exists(join(tempDir, ARCHIVE_DIR))).toBe(false);
    });

    it("preserves .env.mcp (always kept)", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      const result = await executeClean(tempDir, inv, false);

      expect(await exists(join(tempDir, ".env.mcp"))).toBe(true);
      expect(result.kept.some((k) => k.includes(".env.mcp"))).toBe(true);
    });

    it("preserves .hatch3r/ user state (always kept)", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      const result = await executeClean(tempDir, inv, false);

      expect(await exists(join(tempDir, HATCH3R_DIR))).toBe(true);
      expect(result.kept.some((k) => k.includes(HATCH3R_DIR))).toBe(true);
    });

    it("dry run returns what would be removed without modifying files", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      const result = await executeClean(tempDir, inv, true);

      // Should list items in removed
      expect(result.removed.length).toBeGreaterThan(0);

      // But files should still exist
      expect(await exists(join(tempDir, HATCH3R_DIR, "hatch.json"))).toBe(true);
      expect(await exists(join(tempDir, ARCHIVE_DIR))).toBe(true);
      expect(await exists(join(tempDir, WORKTREE_INCLUDE_FILE))).toBe(true);
      expect(await exists(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"))).toBe(true);
    });

    it("handles AGENTS.md with managed block — strips block, preserves user content", async () => {
      // Create AGENTS.md with managed block and user content
      const agentsMd = [
        "# My Project Notes",
        "",
        "<!-- HATCH3R:BEGIN -->",
        "Managed content here",
        "<!-- HATCH3R:END -->",
        "",
        "# User section below",
      ].join("\n");
      await writeFile(join(tempDir, "AGENTS.md"), agentsMd);

      // Build inventory manually — AGENTS.md is handled by the managed-block
      // branch in executeClean, not the adapter-file list.
      const inv: CleanInventory = {
        adapterFiles: [],
        manifestPresent: false,
        archiveDir: false,
        hatch3rDir: false,
        worktreeInclude: false,
        envMcp: false,
        agentsMdHasUserContent: true,
        isWorkspaceRoot: false,
        isWorkspaceMember: false,
        workspaceRootPath: null,
        manifest: null,
      };

      const result = await executeClean(tempDir, inv, false);

      // AGENTS.md should still exist with user content
      const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("<!-- HATCH3R:BEGIN -->");
      expect(content).not.toContain("<!-- HATCH3R:END -->");
      expect(content).toContain("My Project Notes");
      expect(content).toContain("User section below");

      // Should report it was kept
      expect(result.kept.some((k) => k.includes("AGENTS.md") && k.includes("user content"))).toBe(true);
    });
  });

  // ── backupLearnings / restoreLearnings (Wave 7: no-op stubs) ────────

  describe("backupLearnings / restoreLearnings (Wave 7 no-op stubs)", () => {
    // Wave 7: learnings live under `.hatch3r/learnings/` and survive clean
    // automatically — they are never moved. `backupLearnings` returns null
    // and `restoreLearnings` is a no-op so the legacy `clean -> reinit`
    // flow keeps compiling without a parallel command rewrite.

    it("returns null when no learnings directory", async () => {
      const result = await backupLearnings(tempDir);
      expect(result).toBeNull();
    });

    it("returns null even when a learnings directory exists (Wave 7 no-op)", async () => {
      await mkdir(join(tempDir, HATCH3R_DIR, "learnings"), { recursive: true });
      await writeFile(join(tempDir, HATCH3R_DIR, "learnings", "note.md"), "stuff");

      const result = await backupLearnings(tempDir);
      expect(result).toBeNull();
    });

    it("restoreLearnings is a no-op that resolves without error", async () => {
      await expect(restoreLearnings(tempDir, "/tmp/fake-path")).resolves.toBeUndefined();
    });
  });
});
