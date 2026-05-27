/**
 * Synchronization test for `agents/shared/injection-patterns.md` catalog.
 *
 * The canonical markdown file at `agents/shared/injection-patterns.md` is the
 * governance-readable source of truth for prompt-injection screening patterns.
 * The code constants in `src/pipeline/promptGuard.ts` (INJECTION_PATTERNS) and
 * `src/content/learningsValidation.ts` (LEARNINGS_INJECTION_PATTERNS) are the
 * executable source of truth.
 *
 * Invariant: every pattern ID present in code must appear as a row in the
 * catalog. The catalog may contain rows that are ahead of the code (for
 * example, during a multi-sub-agent wave where one agent adds catalog rows
 * and another implements the corresponding regex). The reviewer gate at the
 * end of a wave asserts no catalog-ahead rows remain unimplemented.
 *
 * Finding: C8-D5-M2-injection-pattern-extract (D5-SA5.5-M2).
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINE_INJECTION_PATTERN_IDS } from "../../pipeline/promptGuard.js";
import { LEARNINGS_INJECTION_PATTERN_IDS } from "../../content/learningsValidation.js";

// Resolve the catalog path relative to this test file so it works regardless
// of the current working directory at test time. Other test files in this
// suite call process.chdir() into temp dirs, which would break a cwd-relative
// path under parallel execution.
const THIS_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(
  THIS_FILE_DIR,
  "..",
  "..",
  "..",
  "agents",
  "shared",
  "injection-patterns.md",
);

/**
 * Extract pattern IDs matching a prefix from the catalog markdown.
 *
 * The catalog uses markdown tables of the form:
 *   | Pattern ID | Description | ... |
 *   |-----------|-------------|-----|
 *   | P-PIPE-01 | ... | ... |
 *
 * Returns IDs in document order.
 */
function extractIdsWithPrefix(content: string, prefix: string): string[] {
  const escaped = prefix.replace(/-/g, "\\-");
  const pattern = new RegExp(`\\|\\s*(${escaped}\\d+)\\s*\\|`, "g");
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

describe("injection-patterns.md catalog synchronization", () => {
  it("every pipeline pattern ID in code appears in catalog Section A", async () => {
    const content = await readFile(CATALOG_PATH, "utf-8");
    const catalogIds = new Set(extractIdsWithPrefix(content, "P-PIPE-"));

    expect(catalogIds.size).toBeGreaterThan(0);
    for (const id of PIPELINE_INJECTION_PATTERN_IDS) {
      expect(
        catalogIds.has(id),
        `Pipeline pattern ${id} is in code but missing from catalog Section A`,
      ).toBe(true);
    }
  });

  it("every learnings pattern ID in code appears in catalog Section B", async () => {
    const content = await readFile(CATALOG_PATH, "utf-8");
    const catalogIds = new Set(extractIdsWithPrefix(content, "P-LEARN-"));

    expect(catalogIds.size).toBeGreaterThan(0);
    for (const id of LEARNINGS_INJECTION_PATTERN_IDS) {
      expect(
        catalogIds.has(id),
        `Learnings pattern ${id} is in code but missing from catalog Section B`,
      ).toBe(true);
    }
  });

  it("Section C user-facing screening categories enumerate at least four IDs", async () => {
    const content = await readFile(CATALOG_PATH, "utf-8");
    const catalogIds = extractIdsWithPrefix(content, "C-UI-");

    expect(catalogIds.length).toBeGreaterThanOrEqual(4);
  });

  it("pipeline and learnings pattern IDs are disjoint namespaces", () => {
    const pipeline = new Set(PIPELINE_INJECTION_PATTERN_IDS);
    for (const id of LEARNINGS_INJECTION_PATTERN_IDS) {
      expect(pipeline.has(id)).toBe(false);
    }
  });

  it("pattern IDs within each code constant are unique", () => {
    const pipelineSet = new Set(PIPELINE_INJECTION_PATTERN_IDS);
    expect(pipelineSet.size).toBe(PIPELINE_INJECTION_PATTERN_IDS.length);

    const learningsSet = new Set(LEARNINGS_INJECTION_PATTERN_IDS);
    expect(learningsSet.size).toBe(LEARNINGS_INJECTION_PATTERN_IDS.length);
  });

  it("catalog references the code consumers it extracts patterns for", async () => {
    const content = await readFile(CATALOG_PATH, "utf-8");
    expect(content).toContain("src/pipeline/promptGuard.ts");
    expect(content).toContain("src/content/learningsValidation.ts");
    expect(content).toContain("skills/hatch3r-learn/SKILL.md");
  });

  it("catalog pattern IDs follow the documented format (P-PIPE-NN, P-LEARN-NN, C-UI-NN)", async () => {
    const content = await readFile(CATALOG_PATH, "utf-8");
    const pipeIds = extractIdsWithPrefix(content, "P-PIPE-");
    const learnIds = extractIdsWithPrefix(content, "P-LEARN-");
    const uiIds = extractIdsWithPrefix(content, "C-UI-");

    for (const id of [...pipeIds, ...learnIds, ...uiIds]) {
      expect(id).toMatch(/^(P-PIPE-|P-LEARN-|C-UI-)\d+$/);
    }
  });
});
