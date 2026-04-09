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

// ── Constants ─────────────────────────────────────────────────

const AGENTS_DIR = ".agents";
const ARCHIVE_DIR = ".hatch3r-archive";
const CUSTOMIZE_DIR = ".hatch3r";
const WORKTREE_INCLUDE_FILE = ".worktreeinclude";

// ── Helpers ───────────────────────────────────────────────────

async function createTestRepo(tempDir: string): Promise<void> {
  // .agents/ with learnings
  await mkdir(join(tempDir, AGENTS_DIR, "learnings"), { recursive: true });
  await mkdir(join(tempDir, AGENTS_DIR, "rules"), { recursive: true });

  // .hatch3r-archive/
  await mkdir(join(tempDir, ARCHIVE_DIR), { recursive: true });
  await writeFile(join(tempDir, ARCHIVE_DIR, "old-backup.json"), "{}");

  // .hatch3r/ customizations
  await mkdir(join(tempDir, CUSTOMIZE_DIR), { recursive: true });
  await writeFile(join(tempDir, CUSTOMIZE_DIR, "custom.md"), "# Custom");

  // .worktreeinclude
  await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), ".agents/\n");

  // .env.mcp
  await writeFile(join(tempDir, ".env.mcp"), "SECRET_KEY=abc123");

  // Adapter output: cursor
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
  } catch {
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
      expect(inv.canonicalDir).toBe(false);
      expect(inv.archiveDir).toBe(false);
      expect(inv.customizeDir).toBe(false);
      expect(inv.worktreeInclude).toBe(false);
      expect(inv.envMcp).toBe(false);
      expect(inv.learnings).toEqual([]);
      expect(inv.manifest).toBeNull();
    });

    it("detects .agents/ directory", async () => {
      await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.canonicalDir).toBe(true);
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

    it("detects .hatch3r/ customization directory", async () => {
      await mkdir(join(tempDir, CUSTOMIZE_DIR), { recursive: true });

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.customizeDir).toBe(true);
    });

    it("detects .worktreeinclude", async () => {
      await writeFile(join(tempDir, WORKTREE_INCLUDE_FILE), ".agents/\n");

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.worktreeInclude).toBe(true);
    });

    it("detects .env.mcp", async () => {
      await writeFile(join(tempDir, ".env.mcp"), "SECRET=val");

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.envMcp).toBe(true);
    });

    it("detects learnings files", async () => {
      await mkdir(join(tempDir, AGENTS_DIR, "learnings"), { recursive: true });
      await writeFile(join(tempDir, AGENTS_DIR, "learnings", "session-1.md"), "learned stuff");
      await writeFile(join(tempDir, AGENTS_DIR, "learnings", "session-2.md"), "more stuff");

      const inv = await inventoryArtifacts(tempDir);

      expect(inv.learnings.length).toBe(2);
      expect(inv.learnings).toContain("session-1.md");
      expect(inv.learnings).toContain("session-2.md");
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

    it("removes .agents/ directory", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      await executeClean(tempDir, inv, false);

      expect(await exists(join(tempDir, AGENTS_DIR))).toBe(false);
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

    it("preserves .hatch3r/ customizations (always kept)", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      const result = await executeClean(tempDir, inv, false);

      expect(await exists(join(tempDir, CUSTOMIZE_DIR))).toBe(true);
      expect(result.kept.some((k) => k.includes(CUSTOMIZE_DIR))).toBe(true);
    });

    it("dry run returns what would be removed without modifying files", async () => {
      await createTestRepo(tempDir);
      const inv = await inventoryArtifacts(tempDir);

      const result = await executeClean(tempDir, inv, true);

      // Should list items in removed
      expect(result.removed.length).toBeGreaterThan(0);

      // But files should still exist
      expect(await exists(join(tempDir, AGENTS_DIR))).toBe(true);
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

      // Build inventory manually, excluding AGENTS.md from adapterFiles
      // (collectToolFiles for "amp" would include AGENTS.md as an adapter file,
      // which would cause step 1 to delete it before step 2 handles managed blocks)
      const inv: CleanInventory = {
        adapterFiles: [],
        canonicalDir: false,
        archiveDir: false,
        customizeDir: false,
        worktreeInclude: false,
        envMcp: false,
        agentsMdHasUserContent: true,
        learnings: [],
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

  // ── backupLearnings / restoreLearnings ────────────────────

  describe("backupLearnings / restoreLearnings", () => {
    it("returns null when no learnings directory", async () => {
      const result = await backupLearnings(tempDir);
      expect(result).toBeNull();
    });

    it("returns null when learnings directory is empty", async () => {
      await mkdir(join(tempDir, AGENTS_DIR, "learnings"), { recursive: true });

      const result = await backupLearnings(tempDir);
      expect(result).toBeNull();
    });

    it("backs up and restores learning files correctly", async () => {
      // Create learnings
      const learningsDir = join(tempDir, AGENTS_DIR, "learnings");
      await mkdir(learningsDir, { recursive: true });
      await writeFile(join(learningsDir, "session-1.md"), "learning one");
      await writeFile(join(learningsDir, "session-2.md"), "learning two");

      // Backup
      const backupPath = await backupLearnings(tempDir);
      expect(backupPath).not.toBeNull();
      expect(await exists(backupPath!)).toBe(true);

      // Destroy original
      await rm(join(tempDir, AGENTS_DIR), { recursive: true, force: true });
      expect(await exists(learningsDir)).toBe(false);

      // Restore
      await restoreLearnings(tempDir, backupPath!);

      // Verify restored files
      const restored1 = await readFile(join(learningsDir, "session-1.md"), "utf-8");
      const restored2 = await readFile(join(learningsDir, "session-2.md"), "utf-8");
      expect(restored1).toBe("learning one");
      expect(restored2).toBe("learning two");

      // Backup dir should be cleaned up
      expect(await exists(backupPath!)).toBe(false);
    });
  });
});
