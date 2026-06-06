#!/usr/bin/env node
/**
 * scripts/validate-codeowners.ts — Cycle 12 H D4-6 (D4): Pillars P5 (Governance
 * Self-Quality — Silent Failure Contract), P2 (Scientific & Practical Quality —
 * review integrity).
 *
 * GitHub CODEOWNERS uses LAST-match-wins, and unions owners only when they are
 * written on the SAME line. Two separate single-owner lines for one pattern —
 *
 *     * @denismasatovic
 *     * @vicdotdevelop
 *
 * — therefore mean "the LAST line owns everything": @denismasatovic is silently
 * never auto-requested for files lacking a more-specific match, even though the
 * two lines both name the pattern `*` and so intend co-ownership. GitHub's
 * CODEOWNERS UI surfaces no error for this (it only flags syntactically invalid
 * lines / unknown users), so the drop is invisible. D4-6 found exactly this in
 * the repo's root CODEOWNERS.
 *
 * This gate closes that loop. It parses the active CODEOWNERS file and fails
 * (exit 1) when the SAME pattern appears on two or more non-comment lines that
 * each name exactly one owner — the silent-single-owner-shadow class. The fix
 * the gate steers toward is collapsing them into one line that unions every
 * owner (`* @denismasatovic @vicdotdevelop`).
 *
 * Location precedence mirrors GitHub: the first of `CODEOWNERS`,
 * `.github/CODEOWNERS`, `docs/CODEOWNERS` that exists is the active file and the
 * only one checked (GitHub reads exactly one). An absent CODEOWNERS is a benign
 * info result (no review-routing contract to verify), not a gate failure —
 * mirroring the missing-dir tolerance in scripts/validate-action-pins.ts.
 *
 * Scope (not failed here, to stay narrowly on the D4-6 property): a pattern that
 * appears multiple times where AT LEAST ONE occurrence already lists ≥2 owners
 * (the author has demonstrably opted into multi-owner syntax — re-shadowing is
 * then plausibly intentional escalation, reported at info), and a later
 * more-specific pattern shadowing a broader one (that is the intended
 * last-match-wins behavior, not a bug).
 *
 * Usage: `npm run validate:codeowners`
 *        `tsx scripts/validate-codeowners.ts`
 *        `tsx scripts/validate-codeowners.ts --json`
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/**
 * GitHub CODEOWNERS location precedence: the first existing path wins and is the
 * only file consulted. Relative to repo root.
 */
const CODEOWNERS_LOCATIONS = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"] as const;

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning" | "info";

export interface Finding {
  level: Severity;
  code: string;
  /** Repo-relative file, or "(none)" when no CODEOWNERS exists. */
  file: string;
  /** 1-based line of the offending entry, or 0 for file-level findings. */
  line: number;
  message: string;
}

/** One parsed non-comment, non-blank CODEOWNERS rule line. */
export interface OwnerRule {
  line: number;
  /** Path pattern (first token), e.g. "*" or "src/merge/**". */
  pattern: string;
  /** Owner tokens after the pattern (e.g. ["@a", "@b"], or emails). */
  owners: string[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Repo-relative active CODEOWNERS path, or null when none exists. */
  activeFile: string | null;
  /** Count of parsed rule lines (0 when no file). */
  ruleCount: number;
}

// ── Parsing ───────────────────────────────────────────────────────

/**
 * Parse CODEOWNERS text into its rule lines. Comments (`#...`) and blank lines
 * are dropped; a trailing inline `#` comment on a rule line is stripped before
 * tokenizing. The first whitespace-separated token is the pattern; the rest are
 * owners.
 */
export function parseCodeowners(content: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip a trailing inline comment, then trim. A leading `#` (whole-line
    // comment) collapses to "" and is skipped below.
    const stripped = raw.replace(/#.*$/, "").trim();
    if (stripped === "") continue;
    const tokens = stripped.split(/\s+/);
    rules.push({
      line: i + 1,
      pattern: tokens[0],
      owners: tokens.slice(1),
    });
  }
  return rules;
}

/**
 * Detect the D4-6 silent-single-owner-shadow class: the SAME pattern appearing
 * on ≥2 lines where EVERY occurrence names exactly one owner. Under GitHub's
 * last-match-wins + same-line-union semantics, only the last line's single owner
 * is ever auto-requested; all earlier owners are silently dropped. Returns one
 * error finding per offending pattern (anchored on the last shadowing line).
 *
 * A pattern where any occurrence already lists ≥2 owners is reported at info
 * (the author has opted into multi-owner syntax — see file header Scope) and
 * never fails the gate.
 */
export function findSingleOwnerShadows(file: string, rules: OwnerRule[]): Finding[] {
  const byPattern = new Map<string, OwnerRule[]>();
  for (const rule of rules) {
    // A pattern with zero owners is a different problem (unowned path); not the
    // D4-6 shadow class — skip it here.
    if (rule.owners.length === 0) continue;
    const group = byPattern.get(rule.pattern);
    if (group) group.push(rule);
    else byPattern.set(rule.pattern, [rule]);
  }

  const findings: Finding[] = [];
  for (const [pattern, group] of byPattern) {
    if (group.length < 2) continue;

    const everyLineSingleOwner = group.every((r) => r.owners.length === 1);
    const last = group[group.length - 1];
    const earlierLines = group.slice(0, -1).map((r) => r.line);
    // Each line's single owner, in file order, for the actionable message.
    const droppedOwners = group.slice(0, -1).map((r) => r.owners[0]);

    if (everyLineSingleOwner) {
      findings.push({
        level: "error",
        code: "CODEOWNERS-SINGLE-OWNER-SHADOW",
        file,
        line: last.line,
        message:
          `pattern '${pattern}' is declared on ${group.length} separate single-owner lines ` +
          `(${[...earlierLines, last.line].join(", ")}); GitHub keeps only the LAST (line ${last.line}, ` +
          `owner ${last.owners[0]}) and silently drops ${droppedOwners.join(", ")}. ` +
          `Collapse them into one line that unions every owner: ` +
          `'${pattern} ${group.flatMap((r) => r.owners).join(" ")}'.`,
      });
    } else {
      findings.push({
        level: "info",
        code: "CODEOWNERS-PATTERN-REDECLARED",
        file,
        line: last.line,
        message:
          `pattern '${pattern}' is declared on ${group.length} lines ` +
          `(${[...earlierLines, last.line].join(", ")}); at least one already lists multiple owners, so the ` +
          `last-match-wins shadow may be intentional (info — not the D4-6 single-owner-drop class).`,
      });
    }
  }

  // Deterministic order: by the line the finding is anchored on.
  return findings.sort((a, b) => a.line - b.line);
}

// ── Core ──────────────────────────────────────────────────────────

/** Resolve the first existing CODEOWNERS location, or null. */
async function resolveActiveFile(rootDir: string): Promise<{ rel: string; content: string } | null> {
  for (const rel of CODEOWNERS_LOCATIONS) {
    try {
      const content = await readFile(join(rootDir, rel), "utf8");
      return { rel, content };
    } catch {
      // A missing candidate location just means "try the next one" — ENOENT
      // here is expected for the locations the repo does not use, so it is not a
      // diagnostic-worthy event. (The absent-everywhere case IS reported, once,
      // by the caller as a single CODEOWNERS-ABSENT info finding.) The `continue`
      // body is a control-flow channel, not a silent swallow, so the
      // silent-failure/no-silent-catch contract is satisfied without a disable.
      continue;
    }
  }
  return null;
}

export interface RunOptions {
  /** Repo root to resolve CODEOWNERS locations against; defaults to repo root. */
  rootDir?: string;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const findings: Finding[] = [];

  const active = await resolveActiveFile(rootDir);
  if (active === null) {
    findings.push({
      level: "info",
      code: "CODEOWNERS-ABSENT",
      file: "(none)",
      line: 0,
      message:
        `no CODEOWNERS at any of ${CODEOWNERS_LOCATIONS.join(", ")} (info — no review-routing contract to verify)`,
    });
    return { ...tally(findings), activeFile: null, ruleCount: 0 };
  }

  const rules = parseCodeowners(active.content);
  findings.push(...findSingleOwnerShadows(active.rel, rules));

  return { ...tally(findings), activeFile: active.rel, ruleCount: rules.length };
}

function tally(findings: Finding[]): {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else if (f.level === "warning") warningCount++;
    else infoCount++;
  }
  return { findings, errorCount, warningCount, infoCount };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : f.level === "warning" ? "WARN " : "INFO ";
  const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  return `[${tag} ${f.code}] ${loc} ${f.message}`;
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
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else if (f.level === "warning") console.warn(line);
      else console.log(line);
    }
    const where = result.activeFile ?? "(no CODEOWNERS)";
    console.log(
      `validate-codeowners: ${where} — ${result.ruleCount} rule(s) checked; ${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // reason: a malformed argv[1] just means "not the entrypoint" — fall to
    // false silently so an importing test never triggers main() and never
    // prints a spurious warning on every import.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-codeowners failed:", err);
    process.exit(1);
  });
}
