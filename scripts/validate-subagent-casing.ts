#!/usr/bin/env node
/**
 * scripts/validate-subagent-casing.ts — Finding D5-44 (Cycle 11, D5).
 *
 * The "sub-agent" casing convention (`.claude/rules/content-authoring.md`
 * rule 11 and `CLAUDE.md` -> "sub-agent casing convention") mandates the
 * lowercase-hyphenated form `sub-agent` / `sub-agents` in prose and headings
 * across canonical content. Two non-conforming spellings drifted into ~144
 * places across the corpus with no automated gate: the Title-Case `Sub-Agent`
 * and the closed form `subagent` / `subagents`. This validator is the
 * lightweight CI grep gate the finding's fix column calls for.
 *
 * Preserved (NOT flagged) — these are identifiers/enums the convention exempts:
 *   - `subagent_type`            — the Task-tool spawn field (snake_case key).
 *   - `subagent_invocations`     — the delegation-attestation output field.
 *   - `subagent.spawn` /
 *     `subagent.complete`        — observability event-enum literals.
 *   - `subagentStart`            — a hook-channel event name.
 *   - any `subagent` immediately followed by a letter, `_`, or `.` (the rule
 *     above covers the known identifiers; the boundary also future-proofs new
 *     snake_case / dotted identifiers).
 *   - the `*-sub-agent.md` audit-template FILENAMES are already conformant
 *     (lowercase-hyphen) and are scanned only for their prose, not their name.
 *
 * Ratchet (D5-44): a corpus-wide scrub spans files owned by multiple work
 * units, so a zero-tolerance gate cannot land in one wave without breaking CI
 * on files another unit still owns. The gate therefore reads
 * `scripts/subagent-casing-baseline.json` (a per-file pre-existing count) and:
 *   - FAILS on any violation in a file NOT listed in the baseline (a newly
 *     introduced or regressed violation — including any file already scrubbed
 *     to zero, which is absent from the baseline and so must stay at zero);
 *   - FAILS when a baseline file's count INCREASES above its recorded value;
 *   - PASSES (with an advisory) when a baseline file is at or below its count.
 * Drive each baseline entry to 0 and delete the row as its owning unit
 * normalizes the file; once the map is empty the gate is zero-tolerance.
 *
 * Usage:
 *   npm run validate:efficiency        # aggregated
 *   tsx scripts/validate-subagent-casing.ts
 *   tsx scripts/validate-subagent-casing.ts --json
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/**
 * Canonical content scope for the casing convention (content-authoring rule 11
 * wordlist scope): the published-artifact directories plus authored governance
 * markdown. Excludes audit machinery DATA (`*.json`), the archive backups, and
 * `governance/AUDIT-REPORT.md` — those are reports/snapshots, not authored
 * artifacts, and the report legitimately quotes the old spellings in finding
 * text.
 */
const CONTENT_ROOTS = ["agents", "commands", "rules", "skills", "hooks", "checks"] as const;

/**
 * `readdir` that treats a non-existent directory as empty (a content root or
 * governance subdir may be absent in some layouts — not an error) but re-throws
 * any other failure (e.g. EACCES) so an unexpected I/O fault is surfaced rather
 * than silently swallowed.
 */
async function safeReaddir(absDir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Recursively collect `.md` / `.mdc` files under a directory. */
async function walkMarkdown(absDir: string, out: string[]): Promise<void> {
  for (const e of await safeReaddir(absDir)) {
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      await walkMarkdown(abs, out);
    } else if (e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".mdc"))) {
      out.push(abs);
    }
  }
}

/** The authored-governance subset (top-level `.md` + audit domains + templates). */
async function governanceContentFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const govDir = join(rootDir, "governance");
  for (const e of await safeReaddir(govDir)) {
    if (e.isFile() && e.name.endsWith(".md") && e.name !== "AUDIT-REPORT.md") {
      out.push(join(govDir, e.name));
    }
  }
  for (const sub of ["audit/domains", "audit/templates"]) {
    const abs = join(govDir, sub);
    for (const e of await safeReaddir(abs)) {
      if (e.isFile() && e.name.endsWith(".md")) out.push(join(abs, e.name));
    }
  }
  return out;
}

async function collectContentFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of CONTENT_ROOTS) {
    await walkMarkdown(join(rootDir, r), out);
  }
  out.push(...(await governanceContentFiles(rootDir)));
  return out.sort();
}

// ── Detection ─────────────────────────────────────────────────────
//
// Two violating spellings. The closed-form regex uses a negative lookahead on
// `[A-Za-z_.]` so identifier forms (`subagent_type`, `subagent.spawn`,
// `subagentStart`, `subagent_invocations`) are not matched.

const TITLE_CASE_RE = /Sub-Agents?\b/g;
const CLOSED_FORM_RE = /(?<![A-Za-z])subagents?(?![A-Za-z_.])/g;

export interface CasingFinding {
  /** POSIX-relative path. */
  file: string;
  line: number;
  /** "Sub-Agent" (title-case) or "subagent" (closed-form). */
  kind: "title_case" | "closed_form";
  match: string;
  text: string;
}

/** Count + locate violations in a single file's text. */
export function scanCasing(rel: string, text: string): CasingFinding[] {
  const findings: CasingFinding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(TITLE_CASE_RE)) {
      findings.push({
        file: rel,
        line: i + 1,
        kind: "title_case",
        match: m[0],
        text: line.trim().slice(0, 160),
      });
    }
    for (const m of line.matchAll(CLOSED_FORM_RE)) {
      findings.push({
        file: rel,
        line: i + 1,
        kind: "closed_form",
        match: m[0],
        text: line.trim().slice(0, 160),
      });
    }
  }
  return findings;
}

// ── Baseline ──────────────────────────────────────────────────────

interface BaselineDoc {
  files: Record<string, number>;
}

async function loadBaseline(rootDir: string): Promise<Record<string, number>> {
  let raw: string;
  try {
    raw = await readFile(join(rootDir, "scripts/subagent-casing-baseline.json"), "utf-8");
  } catch (err) {
    // A missing baseline => zero-tolerance (every violation fails). This is the
    // intended terminal state once the ratchet drives the corpus to clean. Any
    // other read error (e.g. EACCES) is unexpected and re-thrown, not swallowed.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const doc = JSON.parse(raw) as BaselineDoc;
  return doc.files ?? {};
}

// ── Runner ────────────────────────────────────────────────────────

export interface RunOptions {
  rootDir?: string;
}

export interface RunResult {
  /** Files scanned. */
  scanned: number;
  /** All violations found, regardless of baseline. */
  findings: CasingFinding[];
  /** Per-file current violation count (only files with >0). */
  counts: Record<string, number>;
  /** Gate-failing entries: new/regressed files + baseline increases. */
  failures: string[];
  /** Files still carrying a tolerated (baseline) violation count. */
  baselinedRemaining: string[];
  errorCount: number;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const [files, baseline] = await Promise.all([
    collectContentFiles(rootDir),
    loadBaseline(rootDir),
  ]);

  const findings: CasingFinding[] = [];
  const counts: Record<string, number> = {};

  for (const abs of files) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    const rel = relative(rootDir, abs).split("\\").join("/");
    const fileFindings = scanCasing(rel, raw);
    if (fileFindings.length > 0) {
      findings.push(...fileFindings);
      counts[rel] = fileFindings.length;
    }
  }

  const failures: string[] = [];
  const baselinedRemaining: string[] = [];

  for (const [rel, n] of Object.entries(counts)) {
    const allowed = baseline[rel] ?? 0;
    if (n > allowed) {
      failures.push(
        `${rel}: ${n} casing violation(s) exceed the allowed baseline of ${allowed}` +
          (allowed === 0 ? " (this file must stay clean — no baseline entry)" : " (regression: count increased)"),
      );
    } else {
      baselinedRemaining.push(`${rel}: ${n}/${allowed} (tolerated; drive to 0 to remove the baseline row)`);
    }
  }

  // A baseline entry for a file that is now clean (count 0) is stale but
  // harmless — flag it so the maintainer can prune it, without failing.
  for (const rel of Object.keys(baseline)) {
    if (!(rel in counts)) {
      baselinedRemaining.push(`${rel}: 0 violations remain — stale baseline row, safe to delete`);
    }
  }

  return {
    scanned: files.length,
    findings,
    counts,
    failures,
    baselinedRemaining,
    errorCount: failures.length,
  };
}

// ── Output ────────────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): { json: boolean } {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.failures) {
      console.error(`[SUBAGENT-CASING] ${f}`);
    }
    const tolerated = result.baselinedRemaining.length;
    console.log(
      `validate-subagent-casing: ${result.scanned} content file(s) scanned, ` +
        `${result.errorCount} gate failure(s), ${tolerated} file(s) at tolerated baseline.`,
    );
    if (result.errorCount === 0 && tolerated > 0) {
      console.log(
        "  Ratchet: drive the remaining baseline files to 0 (sub-agent / sub-agents) and " +
          "delete their rows in scripts/subagent-casing-baseline.json.",
      );
    }
  }
  if (result.errorCount > 0) process.exit(1);
}

// `resolve()` of a string argument does not throw, so a direct comparison is
// sufficient to detect direct invocation vs. import.
const isMain = resolve(process.argv[1] ?? "") === __filename;

if (isMain) {
  main().catch((err) => {
    console.error("validate-subagent-casing failed:", err);
    process.exit(1);
  });
}
