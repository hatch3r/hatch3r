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
 * Framework-dev scope (D19-SA19.2-07): the framework's own maintainer-instruction
 * files load in full at the start of every session yet had no automated wordlist
 * gate — a later edit could introduce slop uncaught. This validator additionally
 * scans:
 *   - .claude/rules/*.md
 *   - .claude/skills/h4tcher-<name>/SKILL.md
 * against the CORE wordlist rows only. The marketing-only patterns (battle-tested,
 * ship-ready, "all 15 adapters", seamless, cutting-edge, state-of-the-art) are NOT
 * applied here: framework-dev prose uses terms like the "Ship Ready" audit score
 * band legitimately, so those patterns belong to the marketing surfaces above.
 * Two files that carry the wordlist AS DATA are excluded so the gate does not flag
 * the phrases they enumerate — a category error the audit named the "definitional
 * table row" case (see WORDLIST_CARRIER_FILES).
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
import { readdir, readFile } from "node:fs/promises";
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
// adapters", seamless, cutting-edge, state-of-the-art). Those six ADDED patterns
// carry `marketingOnly: true` and are applied ONLY to the marketing surfaces; the
// framework-dev surfaces (.claude/rules, .claude/skills) scan with the remaining
// core rows, which correspond to canonical wordlist rows. The canonical prose rows
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
  /**
   * When true, this is a marketing-copy-only pattern with no canonical wordlist
   * row (e.g. "battle-tested"). It applies to the marketing surfaces but NOT to
   * the framework-dev surfaces (.claude/rules, .claude/skills), whose prose uses
   * some of these terms — e.g. the "Ship Ready" audit score band — legitimately.
   */
  marketingOnly?: boolean;
}

const PATTERNS: readonly SlopPattern[] = [
  { source: "best possible", useInstead: "specific measurable target", qualifierEscape: false },
  { source: "best-in-class", useInstead: "specific measurable target", qualifierEscape: false },
  { source: "world-class", useInstead: "specific measurable target", qualifierEscape: false },
  { source: "battle-tested", useInstead: "specific maturity/audit claim (e.g. 'audited each release across 24 governance domains')", qualifierEscape: false, marketingOnly: true },
  { source: "comprehensive and thorough", useInstead: "specific scope statement", qualifierEscape: false },
  { source: "exhaustive", useInstead: "specific scope statement", qualifierEscape: false },
  { source: "robust and resilient", useInstead: "named resilience pattern (circuit breaker, retry with backoff)", qualifierEscape: false },
  { source: "high-quality", useInstead: "specific quality metric", qualifierEscape: true },
  { source: "enterprise-grade", useInstead: "maturity tier (solo/team/scaleup/enterprise)", qualifierEscape: false },
  { source: "production-grade", useInstead: "maturity tier (solo/team/scaleup/enterprise)", qualifierEscape: false },
  { source: "ship[\\s-]?ready", useInstead: "named maturity tier or verification result", qualifierEscape: false, marketingOnly: true },
  { source: "all 15 adapters", useInstead: "current adapter count (3: Claude Code, Cursor, GitHub Copilot)", qualifierEscape: false, marketingOnly: true },
  { source: "seamless(?:ly)?", useInstead: "specific behavior (e.g. 'temp-file + atomic rename')", qualifierEscape: false, marketingOnly: true },
  { source: "cutting-edge", useInstead: "named technology + version", qualifierEscape: false, marketingOnly: true },
  { source: "state-of-the-art", useInstead: "named technology + version", qualifierEscape: false, marketingOnly: true },
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
   * Which pattern set to apply. "marketing" (default) uses every pattern;
   * "framework-dev" skips the marketing-only patterns (see SlopPattern.marketingOnly).
   */
  kind?: "marketing" | "framework-dev";
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
  /**
   * Rel paths actually scanned, partitioned by pattern-set kind (CI-RECON-05):
   * `scannedMarketingSurfaces` is the fixed hand-maintained marketing list;
   * `scannedFrameworkDevSurfaces` is glob-discovered (D19-SA19.2-07) and its
   * length is environment-dependent (e.g. untracked overlay skills exist
   * locally but not in CI), so consumers assert membership / family
   * non-emptiness against these lists — never a total-count pin.
   */
  scannedMarketingSurfaces: string[];
  scannedFrameworkDevSurfaces: string[];
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

// Two framework-dev files carry the wordlist AS DATA. Scanning them for the
// phrases they enumerate is a category error — the audit named this the
// "definitional table row" case (D19-SA19.2-07) — so they are excluded from the
// framework-dev scan:
//   - .claude/rules/anti-slop-enforcement.md — the wordlist definition table;
//     every banned phrase appears in its "Banned Phrase" column.
//   - .claude/skills/h4tcher-pr-resolve/SKILL.md — embeds the anti-slop grep in a
//     code fence, listing banned phrases in a regex alternation as scan tooling.
// POSIX rel paths (forward slash) to match the rels frameworkDevSurfaces builds.
const WORDLIST_CARRIER_FILES: ReadonlySet<string> = new Set([
  ".claude/rules/anti-slop-enforcement.md",
  ".claude/skills/h4tcher-pr-resolve/SKILL.md",
]);

/**
 * Discover the framework-dev maintainer-instruction surfaces to scan:
 * `.claude/rules/*.md` and `.claude/skills/h4tcher-<name>/SKILL.md`, minus the
 * WORDLIST_CARRIER_FILES. Glob-discovered (not a fixed list) so a future rule or
 * skill is covered without editing this file — the durability intent of the
 * finding. A missing `.claude/` tree yields no surfaces (not an error): the repo
 * layout may omit it (e.g. a published package or a test rootDir).
 */
async function frameworkDevSurfaces(rootDir: string): Promise<Surface[]> {
  const out: Surface[] = [];

  const rulesDir = join(rootDir, ".claude", "rules");
  try {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const rel = `.claude/rules/${e.name}`;
      if (WORDLIST_CARRIER_FILES.has(rel)) continue;
      out.push({ rel, abs: join(rulesDir, e.name), kind: "framework-dev" });
    }
  } catch {
    // .claude/rules absent — no framework-dev rule surfaces to scan.
  }

  const skillsDir = join(rootDir, ".claude", "skills");
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || !e.name.startsWith("h4tcher-")) continue;
      const rel = `.claude/skills/${e.name}/SKILL.md`;
      if (WORDLIST_CARRIER_FILES.has(rel)) continue;
      // A skill dir without a SKILL.md is tolerated: the per-surface read in
      // runValidator treats a missing file as a skip, not a failure.
      out.push({ rel, abs: join(skillsDir, e.name, "SKILL.md"), kind: "framework-dev" });
    }
  } catch {
    // .claude/skills absent — no framework-dev skill surfaces to scan.
  }

  return out;
}

// ── Core scan ─────────────────────────────────────────────────────

type CompiledPattern = SlopPattern & { re: RegExp };

function compilePatterns(patterns: readonly SlopPattern[]): CompiledPattern[] {
  return patterns.map((p) => ({
    ...p,
    // Phrase boundaries: require a non-word edge so a longer word does not
    // accidentally match a shorter pattern. Patterns carry explicit optional
    // suffixes where relevant (e.g. "seamless(?:ly)?").
    re: new RegExp(`(?<![\\w-])(${p.source})(?![\\w])`, "i"),
  }));
}

// Marketing surfaces use every pattern; framework-dev surfaces skip the
// marketing-only patterns (see SlopPattern.marketingOnly).
const COMPILED_MARKETING = compilePatterns(PATTERNS);
const COMPILED_FRAMEWORK_DEV = compilePatterns(PATTERNS.filter((p) => !p.marketingOnly));

function scanText(
  surfaceRel: string,
  text: string,
  startLine: number,
  compiled: readonly CompiledPattern[],
  sink: Finding[],
): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of compiled) {
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
  const surfaces =
    opts.surfaces ?? [...defaultSurfaces(rootDir), ...(await frameworkDevSurfaces(rootDir))];
  const findings: Finding[] = [];
  const scannedMarketingSurfaces: string[] = [];
  const scannedFrameworkDevSurfaces: string[] = [];

  for (const s of surfaces) {
    let raw: string;
    try {
      raw = await readFile(s.abs, "utf-8");
    } catch {
      // A missing optional surface is informational, not a gate failure —
      // the repo may not ship every listed file in every layout.
      continue;
    }
    const isFrameworkDev = s.kind === "framework-dev";
    (isFrameworkDev ? scannedFrameworkDevSurfaces : scannedMarketingSurfaces).push(s.rel);
    const compiled = isFrameworkDev ? COMPILED_FRAMEWORK_DEV : COMPILED_MARKETING;
    const { text, startLine } = s.extract ? s.extract(raw) : { text: raw, startLine: 1 };
    scanText(s.rel, text, startLine, compiled, findings);
  }

  return {
    findings,
    scannedSurfaces: scannedMarketingSurfaces.length + scannedFrameworkDevSurfaces.length,
    scannedMarketingSurfaces,
    scannedFrameworkDevSurfaces,
    errorCount: findings.length,
  };
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
      `validate-anti-slop: ${result.scannedSurfaces} surface(s) scanned ` +
        `(${result.scannedMarketingSurfaces.length} marketing + ` +
        `${result.scannedFrameworkDevSurfaces.length} framework-dev), ` +
        `${result.errorCount} hit(s)`,
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
