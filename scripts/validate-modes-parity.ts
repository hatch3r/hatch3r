#!/usr/bin/env node
/**
 * scripts/validate-modes-parity.ts — Pillar P4 (Comprehensive Lean Coverage /
 * Single Source of Truth), P5 (Governance Self-Quality).
 *
 * D22-14 (Cycle 11 D22, Medium): the companion class `agents/modes/` is exempt
 * from `validate.ts` structural validation and no gate asserted that every mode
 * file has a researcher-table row, every row a backing file, or every mode a
 * caller. That blind spot let `user-flows` over-claim its enforcement locus
 * since v1.7.5 (M10). This gate mirrors `scripts/validate-tag-order.ts`: it
 * diffs the backtick-quoted mode names in the `## Research Modes` region of
 * `agents/hatch3r-researcher.md` against the `agents/modes/*.md` stems
 * bidirectionally, and warns on any mode with 0 callers.
 *
 * A "caller" is any artifact under `agents/`, `commands/`, `skills/`, `rules/`
 * that names the mode as a backtick token (`` `mode` ``) or a `modes/<mode>`
 * path — the same dispatch convention the researcher table uses. The mode's
 * own file and the researcher Research Modes registration table do not count
 * (being in the registry is not being called).
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   MODES-ROW-NO-FILE   a `## Research Modes` row names a mode with no
 *                       backing `agents/modes/<mode>.md` file
 *   MODES-FILE-NO-ROW   an `agents/modes/<mode>.md` file has no row in the
 *                       `## Research Modes` region
 *
 * Warnings (non-blocking):
 *
 *   MODES-ZERO-CALLER   a mode has a row + file but no caller outside the
 *                       registration table — likely dead or over-claimed
 *
 * Usage: `npm run validate:efficiency`
 *        `tsx scripts/validate-modes-parity.ts`
 *        `tsx scripts/validate-modes-parity.ts --json`
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const RESEARCHER_FILE = join("agents", "hatch3r-researcher.md");
const MODES_DIR = join("agents", "modes");
const CALLER_DIRS = ["agents", "commands", "skills", "rules"] as const;

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  message: string;
}

export interface RunOptions {
  /** Override the repo root (test injection). Defaults to the package root. */
  rootDir?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Mode stems discovered under agents/modes/. */
  modeStems: string[];
}

/** Mode stems = `agents/modes/*.md` filenames sans extension (no recursion). */
async function listModeStems(modesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(modesDir);
    // reason: an absent agents/modes/ dir is itself the diagnostic — every
    // researcher-table row then surfaces a MODES-ROW-NO-FILE finding (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return [];
  }
  return entries
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -3))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Extract the `## Research Modes` region of the researcher body and the set of
 * backtick-quoted mode names inside it. The region runs from the heading to the
 * next `## ` heading (or EOF). Returns both the region text (so callers can be
 * scanned with the registration table excluded) and the referenced-name set.
 */
function parseResearchModesRegion(body: string): { region: string; referenced: Set<string> } {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Research Modes\b/.test(l));
  if (start === -1) return { region: "", referenced: new Set() };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const region = lines.slice(start, end).join("\n");
  const referenced = new Set<string>();
  for (const m of region.matchAll(/`([a-z][a-z0-9-]+)`/g)) {
    // Mode stems use class-internal naming (no `hatch3r-` prefix). A backtick
    // token like `hatch3r-feature-plan` inside a description cell is an
    // agent/command id the mode gates, not a mode name — exclude it so the
    // parity diff compares modes to modes only.
    if (m[1].startsWith("hatch3r-")) continue;
    referenced.add(m[1]);
  }
  return { region, referenced };
}

/** Recursively collect `.md`/`.mdc` files under a directory. */
async function collectFiles(dir: string): Promise<string[]> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
    // reason: an absent caller dir contributes no callers — the zero-caller
    // check then surfaces MODES-ZERO-CALLER for any mode it would have covered
    // (P5); there is no error to channel for a directory that does not exist.
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectFiles(full)));
    else if (e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".mdc"))) out.push(full);
  }
  return out;
}

/** A backtick token or `modes/<mode>` path reference to `stem` in `text`. */
function referencesMode(text: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`" + esc + "`|modes/" + esc + "\\b").test(text);
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.rootDir ?? ROOT;
  const findings: Finding[] = [];

  const stems = await listModeStems(join(root, MODES_DIR));
  // Normalize CRLF -> LF at read time: the registration-region subtraction
  // below requires the body and the rebuilt region (joined with "\n") to share
  // LF endings — on a CRLF checkout the subtraction otherwise no-ops silently.
  let researcherBody = "";
  try {
    researcherBody = (await readFile(join(root, RESEARCHER_FILE), "utf-8")).replace(/\r\n/g, "\n");
  } catch {
    findings.push({
      level: "error",
      code: "MODES-ROW-NO-FILE",
      file: RESEARCHER_FILE,
      message: "researcher file not found; cannot verify the Research Modes registration table",
    });
  }
  const { region, referenced } = parseResearchModesRegion(researcherBody);
  const stemSet = new Set(stems);

  // Bidirectional parity: every referenced row has a file; every file has a row.
  for (const name of referenced) {
    if (!stemSet.has(name)) {
      findings.push({
        level: "error",
        code: "MODES-ROW-NO-FILE",
        file: RESEARCHER_FILE,
        message: `Research Modes row names \`${name}\` but agents/modes/${name}.md does not exist (add the file, or remove the row)`,
      });
    }
  }
  for (const stem of stems) {
    if (!referenced.has(stem)) {
      findings.push({
        level: "error",
        code: "MODES-FILE-NO-ROW",
        file: `agents/modes/${stem}.md`,
        message: `agents/modes/${stem}.md has no row in the researcher \`## Research Modes\` region (add a backtick-quoted \`${stem}\` row, or remove the file)`,
      });
    }
  }

  // Zero-caller warning: a mode whose only backtick/path reference is the
  // registration table itself. Scan all artifacts; exclude the mode's own file
  // and the researcher region (subtracted from the researcher body before the
  // per-file scan).
  const callerFiles: { rel: string; text: string }[] = [];
  for (const d of CALLER_DIRS) {
    for (const abs of await collectFiles(join(root, d))) {
      const rel = abs.slice(root.length + 1).split(/[\\/]/).join("/");
      // Same CRLF -> LF normalization as the researcher read above, so the
      // region subtraction matches on CRLF checkouts (Windows runners).
      let text = (await readFile(abs, "utf-8")).replace(/\r\n/g, "\n");
      if (rel === RESEARCHER_FILE && region) text = text.split(region).join("");
      callerFiles.push({ rel, text });
    }
  }
  for (const stem of stems) {
    if (!referenced.has(stem)) continue; // parity error already emitted
    const hasCaller = callerFiles.some(
      (f) => f.rel !== `agents/modes/${stem}.md` && referencesMode(f.text, stem),
    );
    if (!hasCaller) {
      findings.push({
        level: "warning",
        code: "MODES-ZERO-CALLER",
        file: `agents/modes/${stem}.md`,
        message: `mode \`${stem}\` has a Research Modes row + backing file but no caller (no \`${stem}\` backtick token or modes/${stem} path outside the registration table) — confirm it is still dispatched or retire it`,
      });
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { findings, errorCount, warningCount, modeStems: stems };
}

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.file}: ${f.message}`;
}

function parseArgs(argv: readonly string[]): { json: boolean } {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    console.log(
      `validate-modes-parity: ${result.modeStems.length} mode file(s) checked against the Research Modes table; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // reason: process.argv[1] unresolvable (e.g. some test runners) — treating
    // as imported (return false) is the safe default; no error to channel (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-modes-parity failed:", err);
    process.exit(1);
  });
}
