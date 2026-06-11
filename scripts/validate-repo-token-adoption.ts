#!/usr/bin/env node
/**
 * scripts/validate-repo-token-adoption.ts — Cycle 11 D14-12
 * ("detection→substitution chain is inert: zero canonical consumers").
 *
 * Pillars: P4 (Lean Coverage — "every file earns existence"),
 *          P3 (Adapter & External Tool Currency),
 *          P5 (Governance Self-Quality).
 *
 * The repo-substitution chain (`src/pipeline/repoSubstitution.ts`) defines
 * the `${HATCH3R:...}` token literals, persists detection results on the
 * manifest, and substitutes every token at adapter output time
 * (`src/adapters/base.ts`). The chain is only worth its weight when the
 * canonical content actually REFERENCES the tokens — a token with zero
 * canonical adopters is dead wiring: the detection + persistence +
 * substitution code all run, but no generated artifact ever carries the
 * resolved value. D14-SA14.4-F2 (High) caught `${HATCH3R:LINTER}` /
 * `${HATCH3R:TEST_FRAMEWORK}` / `${HATCH3R:CI_PROVIDER}` in exactly that
 * state. This gate makes the inert-token condition a build failure so the
 * regression cannot silently return for any current or future token.
 *
 * Adopter definition: a token is "adopted" when its exact literal
 * `${HATCH3R:<NAME>}` appears in at least one canonical content file under
 * the scanned directories. The token *definitions* and *unit tests* live
 * under `src/` and are deliberately NOT counted — they are the mechanism,
 * not a consumer. The authoritative token list is imported from
 * `src/pipeline/repoSubstitution.ts` (`REPO_SUBSTITUTION_TOKENS`) so this
 * validator never re-declares the wire-format literals.
 *
 * Failure mode (one ERROR finding per offending token):
 *
 *   REPO-TOKEN-ZERO-ADOPTERS  a REPO_SUBSTITUTION_TOKENS member is not
 *                             referenced by any canonical content file —
 *                             adopt it in an agent/command/rule/skill/hook
 *                             that names the project's toolchain, or remove
 *                             the token + its detect function.
 *
 * The validator emits a one-line summary plus per-finding diagnostics on
 * stderr, mirroring `scripts/validate-fanout-emission.ts`. CI wires it via
 * `npm run validate:efficiency`.
 *
 * Usage:
 *   tsx scripts/validate-repo-token-adoption.ts
 *   tsx scripts/validate-repo-token-adoption.ts --json
 *   npm run validate:efficiency
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_SUBSTITUTION_TOKENS } from "../src/pipeline/repoSubstitution.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// Canonical content directories that ship to end-user repos. A token is
// "adopted" when it appears in a content file under one of these dirs.
// `src/` and `scripts/` are excluded on purpose: the token literals are
// declared and unit-tested there, and counting those as adopters would
// defeat the gate (a token would always "self-adopt"). `prompts/` is
// listed for forward-compatibility — the class is reserved (canonical
// ships none today per CLAUDE.md) and a missing dir is skipped silently.
const DEFAULT_SCAN_DIRS: readonly string[] = [
  "agents",
  "skills",
  "rules",
  "commands",
  "hooks",
  "checks",
  "prompts",
  "github-agents",
];

// Content file extensions scanned for token references. Rules ship a
// `.md` canonical + a `.mdc` Cursor twin; a token reference in either is
// a legitimate adopter.
const CONTENT_EXTENSIONS: readonly string[] = [".md", ".mdc"];

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  /** The offending token literal, used as the finding subject. */
  token: string;
  message: string;
}

export interface RunOptions {
  /** Override repo root; defaults to the script root. */
  rootDir?: string;
  /** Override the scanned content directories (relative to rootDir). */
  scanDirs?: readonly string[];
  /** Override the token list (tests inject a fixed set). */
  tokens?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Number of tokens checked. */
  checkedTokens: number;
  /** Number of content files scanned across all scan dirs. */
  scannedFiles: number;
  /** Map token -> count of canonical files that reference it. */
  adopterCounts: Record<string, number>;
}

// ── Discovery ─────────────────────────────────────────────────────

async function walkContentFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    // A scan dir that does not exist (e.g. `prompts/`) carries no
    // adopters and is skipped — that is the intended behavior, not a
    // swallowed fault.
    return out;
  }
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const abs = join(absDir, name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      const nested = await walkContentFiles(abs);
      out.push(...nested);
      continue;
    }
    if (!s.isFile()) continue;
    if (!CONTENT_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    out.push(abs);
  }
  return out;
}

// ── Core check ────────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const scanDirs = opts.scanDirs ?? DEFAULT_SCAN_DIRS;
  const tokens = opts.tokens ?? REPO_SUBSTITUTION_TOKENS;

  // Collect every content file once, then count token references in a
  // single pass per file so the scan cost is O(files), not O(files*tokens²).
  const files: string[] = [];
  for (const dirRel of scanDirs) {
    const absDir = join(rootDir, dirRel);
    files.push(...(await walkContentFiles(absDir)));
  }

  const adopterCounts: Record<string, number> = {};
  for (const t of tokens) adopterCounts[t] = 0;

  for (const abs of files) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    for (const t of tokens) {
      if (raw.includes(t)) adopterCounts[t] += 1;
    }
  }

  const findings: Finding[] = [];
  for (const t of tokens) {
    if (adopterCounts[t] === 0) {
      findings.push({
        level: "error",
        code: "REPO-TOKEN-ZERO-ADOPTERS",
        token: t,
        message:
          `token \`${t}\` has zero canonical adopters across ${scanDirs.join(", ")}. ` +
          `The detect+substitute wiring exists but no content consumes it (P4 "every file earns existence"). ` +
          `Adopt it in an agent/command/rule/skill/hook that names the project's toolchain, ` +
          `or remove the token literal from REPO_SUBSTITUTION_TOKENS and delete its detect function.`,
      });
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }

  return {
    findings,
    errorCount,
    warningCount,
    checkedTokens: tokens.length,
    scannedFiles: files.length,
    adopterCounts,
  };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.token}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      // eslint-disable-next-line no-console
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-repo-token-adoption: ${result.checkedTokens} token(s) checked ` +
        `against ${result.scannedFiles} content file(s); ` +
        `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("validate-repo-token-adoption failed:", err);
    process.exit(1);
  });
}
