import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateIntegrityManifest,
  writeIntegrityManifest,
  readIntegrityManifest,
  verifyIntegrity,
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
      const manifest = {
        version: 1,
        generated: "2026-03-04T12:00:00.000Z",
        hatchVersion: "1.1.0",
        files: { "agents/reviewer.md": "sha256:abc123" },
      };

      await writeIntegrityManifest(agentsDir, manifest);
      const loaded = await readIntegrityManifest(agentsDir);

      expect(loaded).toEqual(manifest);
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
    it("should return empty array when no manifest exists", async () => {
      const results = await verifyIntegrity(agentsDir);
      expect(results).toEqual([]);
    });

    it("should report PASS for unmodified files", async () => {
      await mkdir(join(agentsDir, "agents"), { recursive: true });
      const content = "# Agent\nUnmodified content.\n";
      await writeFile(join(agentsDir, "agents", "hatch3r-reviewer.md"), content);

      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);

      const results = await verifyIntegrity(agentsDir);
      const reviewerResult = results.find((r) => r.file === "agents/hatch3r-reviewer.md");

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

      const results = await verifyIntegrity(agentsDir);
      const reviewerResult = results.find((r) => r.file === "agents/hatch3r-reviewer.md");

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

      const results = await verifyIntegrity(agentsDir);
      const reviewerResult = results.find((r) => r.file === "agents/hatch3r-reviewer.md");

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

      const results = await verifyIntegrity(agentsDir);
      const newResult = results.find((r) => r.file === "agents/unknown-agent.md");

      expect(newResult).toBeDefined();
      expect(newResult!.status).toBe("new");
      expect(newResult!.actual).toBe(expectedSha256(newContent));
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

      const results = await verifyIntegrity(agentsDir);

      const statuses = Object.fromEntries(results.map((r) => [r.file, r.status]));
      expect(statuses["agents/hatch3r-reviewer.md"]).toBe("pass");
      expect(statuses["rules/hatch3r-code-standards.md"]).toBe("modified");
      expect(statuses["rules/hatch3r-deleted.md"]).toBe("missing");
      expect(statuses["agents/brand-new.md"]).toBe("new");
    });
  });
});
