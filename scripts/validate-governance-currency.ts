#!/usr/bin/env node
/**
 * scripts/validate-governance-currency.ts — F24.4-D24-1 (Cycle 11 D24 High).
 *
 * Governance currency-header self-consistency gate. CONSTITUTION §2 P5
 * Anti-Bloat Principle 6 mandates a `> Last updated: YYYY-MM-DD` header on
 * every governance prompt, and AUDIT-EXECUTE.md gate 13 fails a header older
 * than the file's last commit — but no `npm run validate` leg enforced the
 * weaker, fully git-independent invariant that surfaced in Cycle 11: a file
 * that records an amendment NEWER than its own `> Last updated:` date (the
 * Cycle-10 drift where `CONSTITUTION.md` declared `Amended: 2026-06-03` while
 * `Last updated: 2026-05-26`). A document cannot be amended after it was last
 * updated — that is an internal contradiction, detectable without any VCS.
 *
 * Check performed (CI gate):
 *
 *   For every scanned governance prompt that carries BOTH a `> Last updated:`
 *   line AND at least one dated `> Amended:` / `> Restructured:` /
 *   `> Established:` line, the `> Last updated:` date MUST be >= the newest of
 *   those amendment dates. A `> Last updated:` that predates the newest
 *   amendment is an ERROR; a missing `> Last updated:` on a scanned file is an
 *   ERROR (mirrors the §2 P5 Principle-6 floor).
 *
 * This is the git-independent subset of D24-1's remediation: the audit-cycle
 * gate 13 (commit-date comparison) remains the stricter staleness check inside
 * AUDIT-EXECUTE; this gate is the always-on `validate:efficiency` leg that
 * catches the self-contradiction class on every CI run, in any checkout, with
 * no overlay-repo history required.
 *
 * Second check (D24-15, Cycle 11 D24 Medium; retargeted to EVOLVE.md after the
 * RE-ENVISION retirement): governance/EVOLVE.md — the unified interactive
 * governance-evolution engine — generates its "Current state:" lines at run
 * time from templates. A hardcoded "<N> command(s)" count on any static
 * "Current state:" line is therefore cached drift: it diverges from the only
 * enumeration source (VISION §CLI Scope) and from CLAUDE.md's architecture
 * table — the Cycle-11 drift recorded "13 commands" while VISION listed 14
 * bullets and CLAUDE.md declared 18. This gate scans every "Current state:"
 * line file-wide and forbids any hardcoded count from entering one, so the
 * count can never silently re-drift (GOV-CLI-COUNT-CACHED, ERROR).
 *
 * Usage:
 *   npm run validate:efficiency        (chained)
 *   tsx scripts/validate-governance-currency.ts
 *   tsx scripts/validate-governance-currency.ts --json
 *   tsx scripts/validate-governance-currency.ts --root <dir>   (hermetic tests)
 *
 * Pillars: P5 (Governance Self-Quality), P2 (Scientific Quality).
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/**
 * Governance prompts that carry a currency header. Paths are POSIX-relative to
 * the repo root. A listed file that is absent on disk is skipped (the overlay
 * layout may not ship every prompt in every checkout).
 */
const GOVERNANCE_FILES: readonly string[] = [
  "governance/CONSTITUTION.md",
  "governance/VISION.md",
  "governance/AUDIT.md",
  "governance/AUDIT-EXECUTE.md",
  "governance/EVOLVE.md",
  "governance/pack-trust-model.md",
];

// Match a leading ISO date (YYYY-MM-DD) wherever it appears on the line.
const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;

export interface CurrencyDrift {
  file: string;
  line?: number;
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface RunOptions {
  rootDir?: string;
  /** Override the file list for tests. */
  files?: readonly string[];
}

export interface RunResult {
  drifts: CurrencyDrift[];
  scannedFiles: number;
  errorCount: number;
  warningCount: number;
}

/** Parse an ISO date into a comparable UTC timestamp, or null if none found. */
function parseIsoDate(text: string): { ts: number; iso: string } | null {
  const m = text.match(ISO_DATE_RE);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const ts = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ts)) return null;
  return { ts, iso };
}

interface HeaderScan {
  lastUpdated: { ts: number; iso: string; line: number } | null;
  newestAmendment: { ts: number; iso: string; line: number } | null;
}

/** Scan a file body for its `> Last updated:` and newest amendment dates. */
export function scanHeaders(body: string): HeaderScan {
  const lines = body.split("\n");
  let lastUpdated: HeaderScan["lastUpdated"] = null;
  let newestAmendment: HeaderScan["newestAmendment"] = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^>\s*Last updated:/i.test(line)) {
      const d = parseIsoDate(line);
      if (d) lastUpdated = { ...d, line: i + 1 };
      continue;
    }
    // `> Amended:` / `> Restructured:` / `> Established:` may carry one or more
    // dates on the same line (CONSTITUTION packs Established | Restructured |
    // Amended on line 3); take the newest date on the line.
    if (/^>\s*(Amended|Restructured|Established):/i.test(line)) {
      // Walk every date on the line, keep the newest.
      let rest = line;
      let best: { ts: number; iso: string } | null = null;
      let m: RegExpMatchArray | null;
      while ((m = rest.match(ISO_DATE_RE)) !== null) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        const ts = Date.parse(`${iso}T00:00:00Z`);
        if (!Number.isNaN(ts) && (best === null || ts > best.ts)) best = { ts, iso };
        rest = rest.slice((m.index ?? 0) + m[0].length);
      }
      if (best && (newestAmendment === null || best.ts > newestAmendment.ts)) {
        newestAmendment = { ...best, line: i + 1 };
      }
    }
  }
  return { lastUpdated, newestAmendment };
}

/**
 * D24-15 (retargeted to EVOLVE.md after the RE-ENVISION retirement): scan
 * governance/EVOLVE.md for a cached "<N> command(s)" count literal on any
 * "Current state:" line, file-wide. The governance-evolution engine generates
 * its "Current state:" lines at run time from templates, so a hardcoded CLI
 * count in the static file is exactly the drift this gate catches — it drifts
 * against VISION §CLI Scope (the sole enumeration) and CLAUDE.md's
 * architecture table. Returns one drift per offending line. Count phrasing on
 * non-"Current state:" lines is not flagged.
 */
export function scanCachedCliCount(body: string, rel: string): CurrencyDrift[] {
  const drifts: CurrencyDrift[] = [];
  const lines = body.split("\n");
  // Matches "13 commands", "14 command", "1 command" — a bare integer count
  // immediately followed by the word command/commands.
  const COUNT_RE = /\b\d+\s+commands?\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Current state:/i.test(line) && COUNT_RE.test(line)) {
      const m = line.match(COUNT_RE);
      drifts.push({
        file: rel,
        line: i + 1,
        level: "error",
        code: "GOV-CLI-COUNT-CACHED",
        message: `"Current state:" line caches a hardcoded CLI count "${m?.[0]}" — it drifts against VISION §CLI Scope (the sole enumeration) and CLAUDE.md's architecture table; use drift-proof phrasing ("the CLI command surface enumerated in VISION §CLI Scope") instead (D24-15)`,
      });
    }
  }
  return drifts;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const files = opts.files ?? GOVERNANCE_FILES;
  const drifts: CurrencyDrift[] = [];
  let scanned = 0;

  for (const rel of files) {
    let body: string;
    try {
      body = await readFile(join(rootDir, rel), "utf-8");
    } catch {
      // Absent governance file in this checkout/layout — not a gate failure.
      continue;
    }
    scanned += 1;

    // D24-15: EVOLVE.md's "Current state:" lines must not cache a hardcoded
    // CLI count. Run before the header-currency early-continue so the check
    // still fires on a file that happens to lack a `> Last updated:` header.
    if (rel.endsWith("EVOLVE.md")) {
      drifts.push(...scanCachedCliCount(body, rel));
    }

    const { lastUpdated, newestAmendment } = scanHeaders(body);

    if (!lastUpdated) {
      // CONSTITUTION §2 P5 Anti-Bloat Principle 6 grades a missing header as
      // Low (not a hard gate-fail), so emit a warning — this gate's hard floor
      // is the self-contradiction class below (Last updated < newest amendment).
      drifts.push({
        file: rel,
        level: "warning",
        code: "GOV-CURRENCY-MISSING",
        message:
          'missing "> Last updated: YYYY-MM-DD" currency header (CONSTITUTION §2 P5 Anti-Bloat Principle 6 — absence is Low)',
      });
      continue;
    }

    if (newestAmendment && newestAmendment.ts > lastUpdated.ts) {
      drifts.push({
        file: rel,
        line: lastUpdated.line,
        level: "error",
        code: "GOV-CURRENCY-STALE",
        message: `"> Last updated: ${lastUpdated.iso}" predates the newest amendment "> ...: ${newestAmendment.iso}" (line ${newestAmendment.line}); a document cannot be amended after it was last updated — bump Last updated to >= ${newestAmendment.iso} (F24.4-D24-1)`,
      });
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const d of drifts) {
    if (d.level === "error") errorCount++;
    else warningCount++;
  }
  return { drifts, scannedFiles: scanned, errorCount, warningCount };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatDrift(d: CurrencyDrift): string {
  const tag = d.level === "error" ? "ERROR" : "WARN ";
  const where = d.line !== undefined ? `${d.file}:${d.line}` : d.file;
  return `[${tag} ${d.code}] ${where}: ${d.message}`;
}

interface CliFlags {
  json: boolean;
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json") };
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1 && argv[rootIdx + 1]) flags.root = argv[rootIdx + 1];
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator(flags.root ? { rootDir: resolve(flags.root) } : {});
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const d of result.drifts) {
      const line = formatDrift(d);
      // eslint-disable-next-line no-console
      if (d.level === "error") console.error(line);
      // eslint-disable-next-line no-console
      else console.warn(line);
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-governance-currency: ${result.scannedFiles} file(s) scanned, ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-governance-currency failed:", err);
    process.exit(1);
  });
}
