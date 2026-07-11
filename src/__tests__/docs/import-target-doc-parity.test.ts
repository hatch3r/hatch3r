import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { IMPORT_FORMATS, IMPORT_TARGETS } from "../../importers/index.js";

// This file lives at src/__tests__/docs/, so the repo root is three levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readRepoFile(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf-8");
}

const MIGRATION_HEADING = "### Migrating from another tool";

/** Extract the quick-start "Migrating from another tool" subsection body so a
 * format name is only credited where migration is documented, not incidentally
 * elsewhere on the page (e.g. "Cursor" the tool appears throughout). */
function migrationSection(quickStart: string): string {
  const start = quickStart.indexOf(MIGRATION_HEADING);
  if (start < 0) return "";
  const rest = quickStart.slice(start + MIGRATION_HEADING.length);
  const nextHeading = rest.indexOf("\n### ");
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
}

/**
 * D14-SA14.4-01 — docs↔code parity guard for the `--import` migration surface.
 *
 * `src/importers/index.ts::runImport` wires every IMPORT_TARGETS member (all
 * IMPORT_FORMATS + `auto`), proven by src/__tests__/importers/index.test.ts.
 * The migration docs must not under-claim that surface — a Cycle-11 drift left
 * quick-start.md declaring three of the four importers "not yet reachable"
 * while a passing test proved the runner accepted all four. This guard fails
 * CI if the docs and the wired target set drift again. It is the "parity probe"
 * sibling to scripts/validate-repo-token-adoption.ts, colocated as a test so it
 * runs in the CI test matrix without expanding the shared validate:efficiency
 * gate; the format list is derived from IMPORT_FORMATS so adding a fifth
 * importer to the code forces both docs to name it.
 */
describe("import-target doc parity (D14-SA14.4-01)", () => {
  const quickStart = readRepoFile("website/docs/getting-started/quick-start.md");
  const readme = readRepoFile("README.md");
  const section = migrationSection(quickStart);

  it("quick-start has a 'Migrating from another tool' section", () => {
    expect(quickStart).toContain(MIGRATION_HEADING);
    expect(section.length).toBeGreaterThan(0);
  });

  it("the migration section names every importable format the CLI wires", () => {
    for (const fmt of IMPORT_FORMATS) {
      expect(
        section,
        `quick-start migration section must document the '${fmt}' import format (an IMPORT_FORMATS member)`,
      ).toContain(fmt);
    }
  });

  it("documents the `--import auto` one-pass target", () => {
    expect(IMPORT_TARGETS).toContain("auto");
    expect(section, "quick-start must document `--import auto`").toContain("--import auto");
  });

  it("makes no 'not reachable' claim about any wired importer (regression on the Cycle-11 drift)", () => {
    expect(section).not.toMatch(/not yet reachable|not reachable from `--import`/i);
  });

  it("README names the full `--import` target set, not cursor alone", () => {
    for (const fmt of IMPORT_FORMATS) {
      expect(readme, `README must name the '${fmt}' import format`).toContain(fmt);
    }
    expect(readme, "README must document `--import auto`").toContain("--import auto");
  });
});
