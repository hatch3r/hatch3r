import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, symlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateIntegrityManifest,
  writeIntegrityManifest,
  readIntegrityManifest,
  verifyIntegrity,
  SCANNED_DIRS,
} from "../../integrity/index.js";

function expectedSha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

describe("integrity", () => {
  let agentsDir: string;

  beforeEach(async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "hatch3r-integrity-"));
    agentsDir = tempDir;
  });

  afterEach(async () => {
    await rm(agentsDir, { recursive: true, force: true });
  });

  describe("generateIntegrityManifest", () => {
    it("should produce correct SHA-256 hashes for .md files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await mkdir(join(agentsDir, "rules"), { recursive: true });

      const agentContent = "---\nid: hatch3r-reviewer\n---\n# Reviewer\n";
      const ruleContent = "---\nid: hatch3r-code-standards\n---\n# Code Standards\n";

      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), agentContent);
      await writeFile(join(agentsDir, "rules", "hatch3r-code-standards.md"), ruleContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.1.0");

      expect(manifest.version).toBe(1);
      expect(manifest.hatchVersion).toBe("1.1.0");
      expect(manifest.files["agents/hatch3r-reviewer.md"]).toBe(expectedSha256(agentContent));
      expect(manifest.files["rules/hatch3r-code-standards.md"]).toBe(expectedSha256(ruleContent));
    });

    it("should ignore non-.md files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), "# Agent\n");
      await writeFile(join(agentsDir, "agents", "notes.txt"), "not markdown");

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(Object.keys(manifest.files)).toHaveLength(1);
      expect(manifest.files["agents/hatch3r-reviewer.md"]).toBeDefined();
    });

    it("should handle empty directories gracefully", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.version).toBe(1);
      expect(Object.keys(manifest.files)).toHaveLength(0);
    });

    it("should populate generatedBy with tool name and version", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.5.0");

      expect(manifest.generatedBy).toBeDefined();
      expect(manifest.generatedBy!.tool).toBe("hatch3r");
      expect(manifest.generatedBy!.version).toBe("1.5.0");
    });

    it("should scan github-agents directory", async () => {
      await mkdir(join(agentsDir, "github-agents"), { recursive: true });
      const ghAgentContent = "---\nid: hatch3r-reviewer\n---\n# GitHub Reviewer Agent\n";
      await writeFile(join(agentsDir, "github-agents", "hatch3r-reviewer.md"), ghAgentContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["github-agents/hatch3r-reviewer.md"]).toBe(expectedSha256(ghAgentContent));
    });

    it("should scan nested directories inside skills", async () => {
      await mkdir(join(agentsDir, "skills", "hatch3r-feature"), { recursive: true });
      const skillContent = "---\nid: hatch3r-feature\n---\n# Feature Skill\n";
      await writeFile(join(agentsDir, "skills", "hatch3r-feature", "SKILL.md"), skillContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["skills/hatch3r-feature/SKILL.md"]).toBe(expectedSha256(skillContent));
    });
  });

  describe("writeIntegrityManifest / readIntegrityManifest", () => {
    it("should round-trip manifest to disk", async () => {
      const files = { "agents/reviewer.md": "sha256:abc123" };
      const checksum = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");
      const manifest = {
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.1.0",
        files,
        checksum,
      };

      await writeIntegrityManifest(agentsDir, manifest);
      const loaded = await readIntegrityManifest(agentsDir);

      expect(loaded).toEqual(manifest);
    });

    it("should round-trip manifest with generatedBy field", async () => {
      const files = { "agents/reviewer.md": "sha256:abc123" };
      const checksum = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");
      const manifest = {
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.5.0",
        generatedBy: { tool: "hatch3r", version: "1.5.0" },
        files,
        checksum,
      };

      await writeIntegrityManifest(agentsDir, manifest);
      const loaded = await readIntegrityManifest(agentsDir);

      expect(loaded).toEqual(manifest);
      expect(loaded!.generatedBy).toEqual({ tool: "hatch3r", version: "1.5.0" });
    });

    it("should accept manifests without generatedBy for backward compat", async () => {
      const files = { "agents/reviewer.md": "sha256:abc123" };
      const checksum = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        files,
        checksum,
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).not.toBeNull();
      expect(result!.generatedBy).toBeUndefined();
    });

    it("should reject manifests with invalid generatedBy shape", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        generatedBy: "not-an-object",
        files: {},
        checksum: createHash("sha256").update(JSON.stringify({})).digest("hex"),
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should reject manifests with generatedBy missing required fields", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        generatedBy: { tool: "hatch3r" },
        files: {},
        checksum: createHash("sha256").update(JSON.stringify({})).digest("hex"),
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null for manifest missing checksum", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.1.0",
        files: { "agents/reviewer.md": "sha256:abc123" },
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when manifest does not exist", async () => {
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null for invalid JSON", async () => {
      await writeFile(join(agentsDir, ".integrity.json"), "{ broken json");
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });
  });

  describe("verifyIntegrity", () => {
    // C9-M16: verifyIntegrity now returns the {ok, manifest, drift} | {ok,
    // errors, drift} discriminated union. Tests read per-file rows from
    // the `drift` array (always populated) and assert on `ok`/`errors`
    // where the partitioned drift state is the assertion target.

    it("returns ok=true with null manifest when no manifest exists", async () => {
      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest).toBeNull();
        expect(result.drift).toEqual([]);
      }
    });

    it("should report PASS for unmodified files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const content = "# Agent\nUnmodified content.\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), content);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(true);
      const reviewerResult = result.drift.find((r) => r.file === "agents/hatch3r-reviewer.md");

      expect(reviewerResult).toBeDefined();
      expect(reviewerResult!.status).toBe("pass");
    });

    it("should detect MODIFIED files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const original = "# Agent\nOriginal content.\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), original);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      const tampered = "# Agent\nTampered content with malicious instructions.\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), tampered);

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.modified).toHaveLength(1);
        expect(result.errors.modified[0].file).toBe("agents/hatch3r-reviewer.md");
      }
      const reviewerResult = result.drift.find((r) => r.file === "agents/hatch3r-reviewer.md");

      expect(reviewerResult).toBeDefined();
      expect(reviewerResult!.status).toBe("modified");
      expect(reviewerResult!.expected).toBe(expectedSha256(original));
      expect(reviewerResult!.actual).toBe(expectedSha256(tampered));
    });

    it("should detect MISSING files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const content = "# Agent\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), content);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      await unlink(join(agentsDir, "agents", "hatch3r-reviewer.md"));

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.missing).toHaveLength(1);
        expect(result.errors.missing[0].file).toBe("agents/hatch3r-reviewer.md");
      }
      const reviewerResult = result.drift.find((r) => r.file === "agents/hatch3r-reviewer.md");

      expect(reviewerResult).toBeDefined();
      expect(reviewerResult!.status).toBe("missing");
      expect(reviewerResult!.expected).toBe(expectedSha256(content));
    });

    it("should flag NEW files not in the manifest", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const original = "# Agent\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), original);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      const newContent = "# New Agent\nUnknown file.\n";
      await writeFile(join(agentsDir, "agents", "unknown-agent.md"), newContent);

      const result = await verifyIntegrity(agentsDir);
      // C9-M16: `new` rows are advisory and do not flip `ok` to false.
      expect(result.ok).toBe(true);
      const newResult = result.drift.find((r) => r.file === "agents/unknown-agent.md");

      expect(newResult).toBeDefined();
      expect(newResult!.status).toBe("new");
      expect(newResult!.actual).toBe(expectedSha256(newContent));
    });

    it("should detect TAMPERED manifest (self-check)", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const content = "# Agent\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), content);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      // Tamper with the checksum
      manifest.checksum = "tampered-checksum-value";
      await writeIntegrityManifest(agentsDir, manifest);

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.tampered).toHaveLength(1);
        expect(result.errors.tampered[0].file).toBe(".integrity.json");
        expect(result.errors.tampered[0].status).toBe("tampered");
      }
      // Drift array carries the tampered row (and only that row — when the
      // manifest itself is tampered, per-file verification is skipped).
      expect(result.drift).toHaveLength(1);
      expect(result.drift[0].file).toBe(".integrity.json");
      expect(result.drift[0].status).toBe("tampered");
    });

    it("should handle mixed statuses across multiple files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await mkdir(join(agentsDir, "rules"), { recursive: true });

      const agentContent = "# Agent\n";
      const ruleContent = "# Rule\n";
      const deletedContent = "# Will be deleted\n";

      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), agentContent);
      await writeFile(join(agentsDir, "rules", "hatch3r-code-standards.md"), ruleContent);
      await writeFile(join(agentsDir, "rules", "hatch3r-deleted.md"), deletedContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      await writeFile(join(agentsDir, "rules", "hatch3r-code-standards.md"), "# Modified rule\n");
      await unlink(join(agentsDir, "rules", "hatch3r-deleted.md"));
      await writeFile(join(agentsDir, "agents", "brand-new.md"), "# New\n");

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(false);

      const statuses = Object.fromEntries(result.drift.map((r) => [r.file, r.status]));
      expect(statuses["agents/hatch3r-reviewer.md"]).toBe("pass");
      expect(statuses["rules/hatch3r-code-standards.md"]).toBe("modified");
      expect(statuses["rules/hatch3r-deleted.md"]).toBe("missing");
      expect(statuses["agents/brand-new.md"]).toBe("new");
    });

    it.skipIf(process.platform === "win32")("should rethrow non-ENOENT errors during file verification", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const content = "# Agent\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), content);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      // Make the file unreadable to trigger a non-ENOENT error
      await chmod(join(agentsDir, "agents", "hatch3r-reviewer.md"), 0o000);

      try {
        await expect(verifyIntegrity(agentsDir)).rejects.toThrow();
      } finally {
        // Restore permissions for cleanup
        await chmod(join(agentsDir, "agents", "hatch3r-reviewer.md"), 0o644);
      }
    });

    it("should sort results alphabetically by file path", async () => {
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await mkdir(join(agentsDir, "agents"), { recursive: true });

      await writeFile(join(agentsDir, "rules", "hatch3r-z-rule.md"), "# Z Rule\n");
      await writeFile(join(agentsDir, "agents", "hatch3r-a-agent.md"), "# A Agent\n");

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      const result = await verifyIntegrity(agentsDir);
      expect(result.drift.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < result.drift.length; i++) {
        expect(result.drift[i].file.localeCompare(result.drift[i - 1].file)).toBeGreaterThanOrEqual(0);
      }
    });

    // C9-M16: explicit coverage for the discriminated-union shape.
    it("ok=true carries the verified manifest when no drift is detected", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const content = "# Agent\nClean.\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-clean.md"), content);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Non-null manifest distinguishes "no manifest" from "manifest passed".
        expect(result.manifest).not.toBeNull();
        expect(result.manifest!.checksum).toBe(manifest.checksum);
      }
    });

    it("ok=false partitions modified and missing into separate error buckets", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "hatch3r-a.md"), "# A\n");
      await writeFile(join(agentsDir, "rules", "hatch3r-b.md"), "# B\n");
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      await writeFile(join(agentsDir, "agents", "hatch3r-a.md"), "# A — modified\n");
      await unlink(join(agentsDir, "rules", "hatch3r-b.md"));

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.modified.map((r) => r.file)).toEqual([
          "agents/hatch3r-a.md",
        ]);
        expect(result.errors.missing.map((r) => r.file)).toEqual([
          "rules/hatch3r-b.md",
        ]);
        expect(result.errors.tampered).toEqual([]);
      }
    });

    it("ok=false on tampered manifest leaves modified and missing buckets empty", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "hatch3r-t.md"), "# T\n");
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      manifest.checksum = "tampered";
      await writeIntegrityManifest(agentsDir, manifest);

      const result = await verifyIntegrity(agentsDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.modified).toEqual([]);
        expect(result.errors.missing).toEqual([]);
        expect(result.errors.tampered).toHaveLength(1);
      }
    });
  });

  describe("validateIntegrityManifest — invalid shapes", () => {
    it("should return null when manifest is a string", async () => {
      await writeFile(join(agentsDir, ".integrity.json"), JSON.stringify("not-an-object"));
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when manifest is null", async () => {
      await writeFile(join(agentsDir, ".integrity.json"), JSON.stringify(null));
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when manifest is an array", async () => {
      await writeFile(join(agentsDir, ".integrity.json"), JSON.stringify([1, 2, 3]));
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when version is not a number", async () => {
      const raw = JSON.stringify({
        version: "1",
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        files: {},
        checksum: "abc",
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when generated is not a string", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: 12345,
        hatchVersion: "1.0.0",
        files: {},
        checksum: "abc",
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when hatchVersion is not a string", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: 100,
        files: {},
        checksum: "abc",
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when files is null", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        files: null,
        checksum: "abc",
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when files is not an object", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        files: "not-an-object",
        checksum: "abc",
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });

    it("should return null when a file hash value is not a string", async () => {
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        files: { "agents/test.md": 42 },
        checksum: "abc",
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const result = await readIntegrityManifest(agentsDir);
      expect(result).toBeNull();
    });
  });

  describe("readIntegrityManifest — error paths", () => {
    it.skipIf(process.platform === "win32")("should rethrow non-ENOENT, non-SyntaxError exceptions", async () => {
      // Write a valid file then remove read permission to trigger EACCES
      await writeFile(join(agentsDir, ".integrity.json"), "{}");
      await chmod(join(agentsDir, ".integrity.json"), 0o000);

      try {
        await expect(readIntegrityManifest(agentsDir)).rejects.toThrow();
      } finally {
        await chmod(join(agentsDir, ".integrity.json"), 0o644);
      }
    });
  });

  describe("collectFiles — edge cases", () => {
    it("should include .mdc files", async () => {
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      const mdcContent = "---\nid: hatch3r-test-rule\n---\n# Test Rule\n";
      await writeFile(join(agentsDir, "rules", "hatch3r-test-rule.mdc"), mdcContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["rules/hatch3r-test-rule.mdc"]).toBe(expectedSha256(mdcContent));
    });

    it("should include .json files", async () => {
      await mkdir(join(agentsDir, "commands"), { recursive: true });
      const jsonContent = '{"id": "hatch3r-test-cmd"}';
      await writeFile(join(agentsDir, "commands", "hatch3r-test-cmd.json"), jsonContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["commands/hatch3r-test-cmd.json"]).toBe(expectedSha256(jsonContent));
    });

    it("should skip symlinks in scanned directories", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const realContent = "# Real Agent\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-real.md"), realContent);

      // Create a symlink that points to the real file
      await symlink(
        join(agentsDir, "agents", "hatch3r-real.md"),
        join(agentsDir, "agents", "hatch3r-symlinked.md"),
      );

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["agents/hatch3r-real.md"]).toBeDefined();
      expect(manifest.files["agents/hatch3r-symlinked.md"]).toBeUndefined();
    });

    it.skipIf(process.platform === "win32")("should rethrow non-ENOENT errors from readdir", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      // Remove read+execute permission from the directory to trigger EACCES
      await chmod(join(agentsDir, "agents"), 0o000);

      try {
        await expect(generateIntegrityManifest(agentsDir, "1.0.0")).rejects.toThrow();
      } finally {
        await chmod(join(agentsDir, "agents"), 0o755);
      }
    });

    it("should exclude files that are not .md, .mdc, or .json", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "readme.txt"), "text file");
      await writeFile(join(agentsDir, "agents", "script.ts"), "typescript file");
      await writeFile(join(agentsDir, "agents", "data.yaml"), "yaml file");
      await writeFile(join(agentsDir, "agents", "valid.md"), "# Valid\n");

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(Object.keys(manifest.files)).toHaveLength(1);
      expect(manifest.files["agents/valid.md"]).toBeDefined();
    });

    it("should handle empty files with correct hash", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "empty.md"), "");

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["agents/empty.md"]).toBe(expectedSha256(""));
    });

    it("should scan mcp directory", async () => {
      await mkdir(join(agentsDir, "mcp"), { recursive: true });
      const mcpContent = "---\nid: hatch3r-mcp-config\n---\n# MCP Config\n";
      await writeFile(join(agentsDir, "mcp", "hatch3r-config.md"), mcpContent);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(manifest.files["mcp/hatch3r-config.md"]).toBe(expectedSha256(mcpContent));
    });
  });

  // D1-SA1.3.2 (High): expectedAdapters / successfulAdapters fields
  describe("generateIntegrityManifest — adapter metadata", () => {
    it("omits expectedAdapters and successfulAdapters when options are not provided", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      expect(manifest.expectedAdapters).toBeUndefined();
      expect(manifest.successfulAdapters).toBeUndefined();
    });

    it("records expectedAdapters when supplied via options", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0", {
        expectedAdapters: ["cursor", "claude"],
      });
      // Array is sorted deterministically
      expect(manifest.expectedAdapters).toEqual(["claude", "cursor"]);
    });

    it("records successfulAdapters when supplied via options", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0", {
        expectedAdapters: ["cursor", "claude"],
        successfulAdapters: ["cursor"],
      });
      expect(manifest.successfulAdapters).toEqual(["cursor"]);
      expect(manifest.expectedAdapters).toEqual(["claude", "cursor"]);
    });

    it("round-trips adapter fields through write/read", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0", {
        expectedAdapters: ["cursor", "claude", "copilot"],
        successfulAdapters: ["cursor", "copilot"],
      });
      await writeIntegrityManifest(agentsDir, manifest);
      const loaded = await readIntegrityManifest(agentsDir);
      expect(loaded!.expectedAdapters).toEqual(["claude", "copilot", "cursor"]);
      expect(loaded!.successfulAdapters).toEqual(["copilot", "cursor"]);
    });

    it("rejects malformed expectedAdapters (non-array)", async () => {
      const files = { "agents/test.md": "sha256:abc" };
      const checksum = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        expectedAdapters: "cursor", // Not an array
        files,
        checksum,
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const loaded = await readIntegrityManifest(agentsDir);
      expect(loaded).toBeNull();
    });

    it("rejects malformed successfulAdapters (non-string element)", async () => {
      const files = { "agents/test.md": "sha256:abc" };
      const checksum = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.0.0",
        successfulAdapters: ["cursor", 42], // Mixed types
        files,
        checksum,
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const loaded = await readIntegrityManifest(agentsDir);
      expect(loaded).toBeNull();
    });

    it("accepts manifests without adapter fields (backward compat)", async () => {
      const files = { "agents/test.md": "sha256:abc" };
      const checksum = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");
      const raw = JSON.stringify({
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.5.0",
        files,
        checksum,
      });
      await writeFile(join(agentsDir, ".integrity.json"), raw);
      const loaded = await readIntegrityManifest(agentsDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.expectedAdapters).toBeUndefined();
      expect(loaded!.successfulAdapters).toBeUndefined();
    });
  });

  describe("generateIntegrityManifest — checksum", () => {
    it("should produce a deterministic checksum from the files map", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "test.md"), "# Test\n");

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      const expectedChecksum = createHash("sha256")
        .update(JSON.stringify(manifest.files))
        .digest("hex");
      expect(manifest.checksum).toBe(expectedChecksum);
    });

    it("should produce an empty checksum for empty file maps", async () => {
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");

      const expectedChecksum = createHash("sha256")
        .update("{}")
        .digest("hex");
      expect(manifest.checksum).toBe(expectedChecksum);
    });

    it("C9-H3: produces the same checksum regardless of file-insertion order", async () => {
      // Write two canonical files under different subtrees, then compute
      // checksums from a fresh manifest twice — between calls, swap the
      // insertion order by deleting and re-writing the second file. With a
      // canonical (sorted) stringifier the checksum is invariant; with the
      // legacy JSON.stringify path, the checksum would diverge.
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(join(agentsDir, "agents", "z-last.md"), "# Z\n");
      await writeFile(join(agentsDir, "rules", "a-first.md"), "# A\n");
      const m1 = await generateIntegrityManifest(agentsDir, "1.0.0");

      // Remove and rewrite to perturb readdir insertion order on systems
      // that report by insertion (ext4 default, tmpfs).
      await unlink(join(agentsDir, "agents", "z-last.md"));
      await writeFile(join(agentsDir, "agents", "z-last.md"), "# Z\n");
      const m2 = await generateIntegrityManifest(agentsDir, "1.0.0");

      expect(m2.checksum).toBe(m1.checksum);
      // Verify also that the checksum equals the canonical (sorted) form.
      const sortedKeys = Object.keys(m1.files).sort();
      const canonical = `{${sortedKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(m1.files[k])}`).join(",")}}`;
      const expected = createHash("sha256").update(canonical).digest("hex");
      expect(m1.checksum).toBe(expected);
    });
  });

  describe("C9-H2 SCANNED_DIRS coverage", () => {
    it("includes the four directories the audit added (policy/learnings/checks/user)", () => {
      expect(SCANNED_DIRS).toEqual(
        expect.arrayContaining(["policy", "learnings", "checks", "user"]),
      );
    });

    it("hashes files placed under policy/learnings/checks/user subtrees", async () => {
      const tamperSubtrees = ["policy", "learnings", "checks", "user"] as const;
      for (const sub of tamperSubtrees) {
        await mkdir(join(agentsDir, sub), { recursive: true });
        await writeFile(join(agentsDir, sub, "probe.md"), `# probe ${sub}\n`);
      }

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      for (const sub of tamperSubtrees) {
        const key = `${sub}/probe.md`;
        expect(manifest.files[key]).toBe(expectedSha256(`# probe ${sub}\n`));
      }
    });

    it("verifyIntegrity detects modifications under newly scanned subtrees", async () => {
      await mkdir(join(agentsDir, "policy"), { recursive: true });
      const original = "# policy v1\n";
      await writeFile(join(agentsDir, "policy", "p.md"), original);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      // Mutate after seal — verify must surface a `modified` row.
      await writeFile(join(agentsDir, "policy", "p.md"), "# policy v2\n");
      const result = await verifyIntegrity(agentsDir);
      // C9-M16: read per-file rows from `drift`; the modified row also
      // appears in `errors.modified` on the ok=false branch.
      expect(result.ok).toBe(false);
      const row = result.drift.find((r) => r.file === "policy/p.md");
      expect(row).toBeDefined();
      expect(row?.status).toBe("modified");
    });
  });
});
