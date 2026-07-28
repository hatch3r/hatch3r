/**
 * DD-D5 (release/2.8.5): executable import-boundary contract over src/.
 *
 * Two rules, mirroring the `no-restricted-imports` config in
 * eslint.config.js (DD-D2) — but where that config is severity "warn"
 * (burn-down inventory for the remaining chalk/ui couplings), THIS suite
 * pins the subset that is clean today as a FAILING gate so it cannot
 * regress:
 *
 *   Rule 1 — no module outside src/cli/ imports src/cli/** EXCEPT the
 *            sanctioned logging/state allowlist (D0 decision):
 *            cli/shared/ui.js, cli/shared/paths.js, cli/shared/runId.js.
 *   Rule 2 — no module outside src/cli/ statically imports the interactive
 *            CLI libraries `commander` or `inquirer` (incl. @inquirer/*).
 *            (chalk/ora/boxen stay at the eslint warn tier until their
 *            couplings are extracted; dynamic-import fallbacks are
 *            annotated at their sites, e.g. src/cliTools/install.ts DD-D4.)
 *
 * Implementation: readdir walk + regex over comment-stripped source
 * (precedent: the governance drift suites under src/__tests__/governance/).
 */

import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** Directories never walked: tests (simulate anything) and src/cli itself. */
const SKIP_DIRS = new Set(["__tests__", "cli"]);

/** Rule-1 allowlist — import specifiers ENDING with one of these are the
 *  sanctioned logging/state coupling (D0). */
const CLI_IMPORT_ALLOWLIST = [
  "/cli/shared/ui.js",
  "/cli/shared/paths.js",
  "/cli/shared/runId.js",
];

/** Rule-2 banned static specifiers for domain code. */
function isBannedCliLibrary(specifier: string): boolean {
  return (
    specifier === "commander" ||
    specifier === "inquirer" ||
    specifier.startsWith("inquirer/") ||
    specifier.startsWith("@inquirer/")
  );
}

async function walkDomainSources(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) && dir === SRC_ROOT) continue;
      await walkDomainSources(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(join(dir, entry.name));
    }
  }
}

/** Strip block + line comments so JSDoc prose citing import paths cannot
 *  produce false positives. String contents may be mangled by the line-
 *  comment pass (e.g. URLs in template literals) — harmless here because
 *  only `from "..."`-shaped remains are inspected afterwards. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Extract static import/re-export specifiers (`import ... from "x"`,
 *  `export ... from "x"`, bare `import "x"`). Dynamic `import("x")` is
 *  deliberately NOT matched — see the header. */
function staticImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  const specifiers: string[] = [];
  const fromRe = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (const re of [fromRe, bareRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) specifiers.push(m[1]);
  }
  return specifiers;
}

interface Violation {
  file: string;
  specifier: string;
  rule: "rule-1-cli-import" | "rule-2-cli-library";
}

async function collectViolations(): Promise<Violation[]> {
  const files: string[] = [];
  await walkDomainSources(SRC_ROOT, files);
  expect(files.length).toBeGreaterThan(50); // sanity: the walk found the tree

  const violations: Violation[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf-8");
    for (const specifier of staticImportSpecifiers(source)) {
      const rel = relative(SRC_ROOT, file);
      if (specifier.includes("/cli/") && !CLI_IMPORT_ALLOWLIST.some((a) => specifier.endsWith(a))) {
        violations.push({ file: rel, specifier, rule: "rule-1-cli-import" });
      }
      if (isBannedCliLibrary(specifier)) {
        violations.push({ file: rel, specifier, rule: "rule-2-cli-library" });
      }
    }
  }
  return violations;
}

describe("DD-D5 import boundaries (architecture)", () => {
  it("Rule 1: no domain module imports src/cli/** outside the ui/paths/runId allowlist", async () => {
    const violations = (await collectViolations()).filter((v) => v.rule === "rule-1-cli-import");
    expect(
      violations,
      `domain modules importing src/cli/** outside the allowlist:\n` +
        violations.map((v) => `  ${v.file} -> ${v.specifier}`).join("\n"),
    ).toEqual([]);
  });

  it("Rule 2: no domain module statically imports commander or inquirer", async () => {
    const violations = (await collectViolations()).filter((v) => v.rule === "rule-2-cli-library");
    expect(
      violations,
      `domain modules importing interactive CLI libraries:\n` +
        violations.map((v) => `  ${v.file} -> ${v.specifier}`).join("\n"),
    ).toEqual([]);
  });
});
