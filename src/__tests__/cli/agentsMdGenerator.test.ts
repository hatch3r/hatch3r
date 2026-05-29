import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENTS_MD_INNER,
  AGENTS_MD_FULL,
  generateRootAgentsMd,
  generateCanonicalAgentsMd,
} from "../../cli/shared/agentsMdGenerator.js";

// D1-SA1.7-F9 (Cycle 10 Wave 4): agentsMdGenerator.ts was extracted from the
// former agentsContent.ts. The root + canonical AGENTS.md generators were
// only ever consumed via `vi.fn()` mocks (config.test.ts / configHelpers.ts),
// so their bodies had no executing test coverage. These cases exercise the
// real implementations against a seeded temp tree and the empty-dir fallback,
// adding the per-module coverage the split's CQ8/testability intent calls for.

describe("agentsMdGenerator", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-agentsmd-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Seed a canonical-shaped tree: agents/, skills/<id>/SKILL.md, commands/. */
  async function seed(): Promise<void> {
    await mkdir(join(tempDir, "agents"), { recursive: true });
    await mkdir(join(tempDir, "commands"), { recursive: true });
    await mkdir(join(tempDir, "skills", "hatch3r-feature"), { recursive: true });

    await writeFile(
      join(tempDir, "agents", "hatch3r-implementer.md"),
      "---\nid: hatch3r-implementer\ntype: agent\ndescription: Implementation agent\ntags: [core, implementation]\n---\n# Implementer\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "commands", "hatch3r-board-pickup.md"),
      "---\nid: hatch3r-board-pickup\ntype: command\ndescription: Board pickup\ntags: [board]\n---\n# Pickup\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "skills", "hatch3r-feature", "SKILL.md"),
      "---\nid: hatch3r-feature\ntype: skill\ndescription: Feature workflow skill\ntags: [core, implementation]\n---\n# Feature\n\n## Steps\n\n1. Do the thing\n2. Verify\n",
      "utf-8",
    );
  }

  describe("AGENTS_MD constants", () => {
    it("AGENTS_MD_FULL wraps AGENTS_MD_INNER in a managed block", () => {
      expect(AGENTS_MD_FULL).toContain(AGENTS_MD_INNER);
      expect(AGENTS_MD_INNER).toContain("# Project Agent Instructions");
    });
  });

  describe("generateRootAgentsMd", () => {
    it("builds agent / skill / command tables from on-disk content", async () => {
      await seed();
      const { full, inner } = await generateRootAgentsMd(tempDir);

      expect(inner).toContain("# Project Agent Instructions");
      expect(inner).toContain("## Agents");
      expect(inner).toContain("`hatch3r-implementer`");
      expect(inner).toContain("## Skills");
      expect(inner).toContain("`hatch3r-feature`");
      expect(inner).toContain("## Commands");
      expect(inner).toContain("`hatch3r-board-pickup`");
      expect(inner).toContain("## Directory Structure");
      // full wraps inner in a managed block.
      expect(full).toContain(inner);
    });

    it("falls back to the static AGENTS_MD_FULL when nothing is on disk", async () => {
      const { full, inner } = await generateRootAgentsMd(tempDir);
      expect(full).toBe(AGENTS_MD_FULL);
      expect(inner).toBe(AGENTS_MD_INNER);
    });
  });

  describe("generateCanonicalAgentsMd", () => {
    it("renders the universal pipeline plus rosters from on-disk content", async () => {
      await seed();
      const md = await generateCanonicalAgentsMd(tempDir);

      expect(md).toContain("# hatch3r — Canonical Agent Instructions");
      expect(md).toContain("## Universal Sub-Agent Pipeline");
      expect(md).toContain("## Agent Roster");
      expect(md).toContain("`hatch3r-implementer`");
      expect(md).toContain("## Available Skills");
      expect(md).toContain("`hatch3r-feature`");
      // The seeded skill has a "## Steps" section, so a Skill Quick Reference
      // with the extracted checklist is emitted.
      expect(md).toContain("## Skill Quick Reference");
      expect(md).toContain("## Available Commands");
      expect(md).toContain("`hatch3r-board-pickup`");
      expect(md).toContain("## Directory Structure");
    });

    it("emits the static header even when the content tree is empty", async () => {
      const md = await generateCanonicalAgentsMd(tempDir);
      expect(md).toContain("# hatch3r — Canonical Agent Instructions");
      expect(md).toContain("## Universal Sub-Agent Pipeline");
      // No rosters when nothing is on disk.
      expect(md).not.toContain("## Agent Roster");
      expect(md).not.toContain("## Available Skills");
    });
  });
});
