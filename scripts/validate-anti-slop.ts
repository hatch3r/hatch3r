#!/usr/bin/env node
/**
 * scripts/validate-anti-slop.ts — F16.1-H5 (Cycle 10 D16 cross-domain).
 *
 * The anti-slop wordlist (`CLAUDE.md` -> "## Anti-Slop Wordlist" and
 * `.claude/rules/anti-slop-enforcement.md`) is enforced inside `governance/`,
 * `agents/`, `commands/`, `rules/`, `skills/`, `hooks/` by the audit cycle —
 * but the framework's own user-facing surfaces (README, SECURITY, CONTRIBUTING,
 * the current CHANGELOG entry, and the npm + Cursor manifest descriptions) had
 * no automated gate, so phrases like "battle-tested" shipped to npm and the
 * Cursor marketplace. F16.1-H5 closes that gap: this validator scans those
 * surfaces against the same wordlist and fails CI on any hit.
 *
 * Scope (the surfaces the finding names):
 *   - README.md
 *   - SECURITY.md
 *   - CONTRIBUTING.md
 *   - CHANGELOG.md — current (topmost) release entry only. Historical entries
 *     are immutable per Keep-a-Changelog convention: they describe what was
 *     true at that release (e.g. "all 15 adapters" was accurate before the
 *     v1.9.0 hard cut), and rewriting them would be dishonest. The gate scans
 *     only the section between the first `## [` header and the second.
 *   - package.json   -> `.description`
 *   - .cursor-plugin/plugin.json -> `.description`
 *
 * Each pattern carries a measurable-qualifier escape: a hit is suppressed when
 * the matched phrase is immediately followed (same line) by a measurable
 * qualifier marker — a digit, a percentage, "p50/p75/p95/p99", or an explicit
 * file:line / URL citation — mirroring the wordlist's "Use Instead" column
 * (e.g. "95th percentile under 200ms" is allowed, bare "high-quality" is not).
 *
 * Usage:
 *   npm run validate:anti-slop
 *   tsx scripts/validate-anti-slop.ts --json
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Wordlist (scoped marketing-surface subset — NOT a row-for-row mirror) ────
//
// D24-SA24.1-03: this array is DERIVED from the canonical wordlist (CLAUDE.md
// "## Anti-Slop Wordlist" / .claude/rules/anti-slop-enforcement.md / CONSTITUTION
// §2 P5) but is deliberately NOT identical to it. It keeps only the phrases that
// plausibly ship on the marketing surfaces scanned above and ADDS marketing-only
// patterns with no canonical wordlist row (battle-tested, ship-ready, "all 15
// adapters", seamless, cutting-edge, state-of-the-art). The canonical prose rows
// (ensure/properly/correctly/as-needed/scalable/carefully/note-phrases/
// might-affect/successfully-completed) are omitted here — they false-positive on
// qualified README/SECURITY usage and are enforced inside the six content dirs by
// the audit cycle, not by this gate. This file header defines the pattern set.
//
// Each entry is matched case-insensitively as a whole-phrase regex. Phrases
// that the wordlist allows "with a measurable qualifier" are still listed
// here; the qualifier escape (see QUALIFIER_RE) suppresses the hit when a
// measurable marker follows on the same line.

interface SlopPattern {
  /** Regex source (case-insensitive, applied per line). */
  source: string;
  /** Human-readable replacement guidance from the wordlist. */
  useInstead: string;
  /** When true, a same-line measurable qualifier suppresses the hit. */
  qualifierEscape: boolean;
}

const PATTERNS: readonly SlopPattern[] = [
  { source: "best possible", useInstead: "specific measurable target", qualifierEscape: false },
  { source: "best-in-class", useInstead: "specific measurable target", qualifierEscape: false },
  { source: "world-class", useInstead: "specific measurable target", qualifierEscape: false },
  { source: "battle-tested", useInstead: "specific maturity/audit claim (e.g. 'audited each release across 24 governance domains')", qualifierEscape: false },
  { source: "comprehensive and thorough", useInstead: "specific scope statement", qualifierEscape: false },
  { source: "exhaustive", useInstead: "specific scope statement", qualifierEscape: false },
  { source: "robust and resilient", useInstead: "named resilience pattern (circuit breaker, retry with backoff)", qualifierEscape: false },
  { source: "high-quality", useInstead: "specific quality metric", qualifierEscape: true },
  { source: "enterprise-grade", useInstead: "maturity tier (solo/team/scaleup/enterprise)", qualifierEscape: false },
  { source: "production-grade", useInstead: "maturity tier (solo/team/scaleup/enterprise)", qualifierEscape: false },
  { source: "ship[\\s-]?ready", useInstead: "named maturity tier or verification result", qualifierEscape: false },
  { source: "all 15 adapters", useInstead: "current adapter count (3: Claude Code, Cursor, GitHub Copilot)", qualifierEscape: false },
  { source: "seamless(?:ly)?", useInstead: "specific behavior (e.g. 'temp-file + atomic rename')", qualifierEscape: false },
  { source: "cutting-edge", useInstead: "named technology + version", qualifierEscape: false },
  { source: "state-of-the-art", useInstead: "named technology + version", qualifierEscape: false },
];

// A measurable qualifier on the same line suppresses a qualifier-escape hit:
// a digit, a percentage, a latency percentile, or a citation.
const QUALIFIER_RE = /(\d|%|p(?:50|75|90|95|99)\b|https?:\/\/|\.\w+:\d+)/i;

// ── Types ─────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  phrase: string;
  useInstead: string;
  text: string;
}

interface Surface {
  /** POSIX-relative path for diagnostics. */
  rel: string;
  /** Absolute path on disk. */
  abs: string;
  /**
   * Optional content extractor. Returns the text to scan (and the 1-based
   * line offset that text starts at in the file, for accurate line numbers).
   * Default: scan the whole file from line 1.
   */
  extract?: (raw: string) => { text: string; startLine: number };
}

export interface RunOptions {
  rootDir?: string;
  /** Override the surface list for tests. */
  surfaces?: Surface[];
}

export interface RunResult {
  findings: Finding[];
  scannedSurfaces: number;
  errorCount: number;
}

// ── Content extractors ────────────────────────────────────────────

/** Pull the JSON `.description` string and its line number from a manifest. */
function extractJsonDescription(raw: string): { text: string; startLine: number } {
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return { text: m[1], startLine: i + 1 };
  }
  return { text: "", startLine: 1 };
}

/**
 * Return only the current (topmost) CHANGELOG entry: everything from the first
 * `## [` header up to — but not including — the second `## [` header.
 * Historical entries below are out of scope (immutable release history).
 */
function extractCurrentChangelogEntry(raw: string): { text: string; startLine: number } {
  const lines = raw.split("\n");
  let first = -1;
  let second = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\[/.test(lines[i])) {
      if (first === -1) first = i;
      else {
        second = i;
        break;
      }
    }
  }
  if (first === -1) return { text: "", startLine: 1 };
  const end = second === -1 ? lines.length : second;
  return { text: lines.slice(first, end).join("\n"), startLine: first + 1 };
}

// ── Surface list ──────────────────────────────────────────────────

function defaultSurfaces(rootDir: string): Surface[] {
  const at = (rel: string, extract?: Surface["extract"]): Surface => ({
    rel,
    abs: join(rootDir, rel),
    extract,
  });
  return [
    at("README.md"),
    at("SECURITY.md"),
    at("CONTRIBUTING.md"),
    at("CHANGELOG.md", extractCurrentChangelogEntry),
    at("package.json", extractJsonDescription),
    at(".cursor-plugin/plugin.json", extractJsonDescription),
  ];
}

// ── Core scan ─────────────────────────────────────────────────────

const COMPILED = PATTERNS.map((p) => ({
  ...p,
  // Phrase boundaries: require a non-word edge so a longer word does not
  // accidentally match a shorter pattern. Patterns carry explicit optional
  // suffixes where relevant (e.g. "seamless(?:ly)?").
  re: new RegExp(`(?<![\\w-])(${p.source})(?![\\w])`, "i"),
}));

function scanText(
  surfaceRel: string,
  text: string,
  startLine: number,
  sink: Finding[],
): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of COMPILED) {
      const m = line.match(p.re);
      if (!m) continue;
      if (p.qualifierEscape && QUALIFIER_RE.test(line)) continue;
      sink.push({
        file: surfaceRel,
        line: startLine + i,
        phrase: m[1],
        useInstead: p.useInstead,
        text: line.trim().slice(0, 160),
      });
    }
  }
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const surfaces = opts.surfaces ?? defaultSurfaces(rootDir);
  const findings: Finding[] = [];
  let scanned = 0;

  for (const s of surfaces) {
    let raw: string;
    try {
      raw = await readFile(s.abs, "utf-8");
    } catch {
      // A missing optional surface is informational, not a gate failure —
      // the repo may not ship every listed file in every layout.
      continue;
    }
    scanned += 1;
    const { text, startLine } = s.extract ? s.extract(raw) : { text: raw, startLine: 1 };
    scanText(s.rel, text, startLine, findings);
  }

  return { findings, scannedSurfaces: scanned, errorCount: findings.length };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  return `[ANTI-SLOP] ${f.file}:${f.line}: "${f.phrase}" -> use ${f.useInstead}\n    ${f.text}`;
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
      // eslint-disable-next-line no-console
      console.error(formatFinding(f));
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-anti-slop: ${result.scannedSurfaces} surface(s) scanned, ${result.errorCount} hit(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

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
    console.error("validate-anti-slop failed:", err);
    process.exit(1);
  });
}
