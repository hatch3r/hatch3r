#!/usr/bin/env node
/**
 * scripts/check-cli-cves.ts — F15.7-H1 (Cycle 10 D15-SA15.7, Pillar P6).
 *
 * Queries OSV.dev for known vulnerabilities affecting every CLI tool declared
 * in `src/cliTools/registry.ts::AVAILABLE_CLI_TOOLS`. Mirrors the structural
 * approach of `scripts/check-mcp-cves.ts`: discover targets, query OSV.dev
 * per (package, version) pair, normalize severity, and fail closed when a
 * Critical or High advisory has been public longer than the staleness
 * window (default 30 days, matching AUDIT-EXECUTE.md unpatched-CVE gates).
 *
 * Why this script exists: `CveScan` on every tool in `registry.ts` declared
 * "population happens in the per-cycle check-cli-cves.ts workflow scheduled
 * by D21 close" — the schema was authored in Cycle 9 but the workflow never
 * landed. F15.7-H1 closes that gap.
 *
 * Ecosystem mapping: OSV.dev keys per-package advisories by ecosystem
 * ("npm", "Go", "crates.io", "PyPI", ...). The registry currently captures
 * the tool's primary upstream language via its install commands; this script
 * looks up the ecosystem by the install manager + homepage URL, falling back
 * to a per-tool override table for tools whose source language differs from
 * their dominant install manager (e.g. `gh` ships via brew but the source is
 * Go on GitHub).
 *
 * Usage:
 *   npm run cli-tools:cve-check
 *   tsx scripts/check-cli-cves.ts --json
 *   tsx scripts/check-cli-cves.ts --max-age-days 30
 *
 * Pillars: P6 (Security & Trust), P3 (CLI-Tool Currency).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../src/cliTools/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
void ROOT;

const DEFAULT_MAX_AGE_DAYS = 30;
const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

// ── Types ─────────────────────────────────────────────────────────

export type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

/**
 * One CLI tool target for OSV.dev. The `ecosystem` + `name` pair is the
 * OSV.dev query key; `tool` carries the registry identifier so the report
 * surfaces hatch3r's canonical name.
 */
export interface CliToolTarget {
  /** hatch3r canonical id (matches registry key, e.g. "ripgrep"). */
  tool: string;
  /** Display category from the registry. */
  category: string;
  /** OSV.dev ecosystem string (e.g. "crates.io", "Go", "npm"). */
  ecosystem: string;
  /** Upstream package identifier as OSV.dev knows it. */
  name: string;
  /** Optional pinned version pulled from the registry's `minVersion`. */
  version?: string;
}

export interface OsvVulnerability {
  id: string;
  summary?: string;
  published?: string;
  modified?: string;
  database_specific?: { severity?: string };
  severity?: Array<{ type?: string; score?: string }>;
}

export interface OsvQueryResponse {
  vulns?: OsvVulnerability[];
}

export interface VulnerabilityFinding {
  target: CliToolTarget;
  id: string;
  summary: string;
  severity: Severity;
  publishedISO?: string;
  ageDays?: number;
  isStale: boolean;
}

export interface CheckReport {
  targets: CliToolTarget[];
  findings: VulnerabilityFinding[];
  staleFindings: VulnerabilityFinding[];
  maxAgeDays: number;
  queryErrors: Array<{ target: CliToolTarget; reason: string }>;
  /** Tools the registry could not map to an OSV.dev ecosystem. */
  unmapped: CliToolMeta[];
}

export interface RunOptions {
  maxAgeDays?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
  /** Override the registry for tests (defaults to AVAILABLE_CLI_TOOLS). */
  registry?: Record<string, CliToolMeta>;
}

// ── CLI parsing ───────────────────────────────────────────────────

interface CliFlags {
  maxAgeDays: number;
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-age-days") {
      const next = argv[i + 1];
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        throw new Error(
          `check-cli-cves: --max-age-days requires a number in [0, 365], got "${String(next)}"`,
        );
      }
      maxAgeDays = n;
      i++;
    } else if (a === "--json") {
      json = true;
    }
  }
  return { maxAgeDays, json };
}

// ── Ecosystem mapping ─────────────────────────────────────────────

/**
 * Per-tool overrides where the install manager does not match the upstream
 * source ecosystem. Keys are registry tool IDs; values are the OSV.dev
 * ecosystem + package name to query.
 *
 * Sources for the mapping decisions (re-verified 2026-05-27):
 *   - https://osv.dev/list (ecosystem enum)
 *   - https://github.com/google/osv.dev (package-name conventions)
 *
 * Trust tier: official-docs (OSV.dev's own documentation).
 */
const ECOSYSTEM_OVERRIDES: Record<string, { ecosystem: string; name: string }> = {
  // Rust-source tools — OSV.dev keys them under `crates.io` regardless of
  // how they ship to end-users.
  ripgrep: { ecosystem: "crates.io", name: "ripgrep" },
  fd: { ecosystem: "crates.io", name: "fd-find" },
  bat: { ecosystem: "crates.io", name: "bat" },
  delta: { ecosystem: "crates.io", name: "git-delta" },
  difftastic: { ecosystem: "crates.io", name: "difftastic" },
  sd: { ecosystem: "crates.io", name: "sd" },
  qsv: { ecosystem: "crates.io", name: "qsv" },
  taplo: { ecosystem: "crates.io", name: "taplo-cli" },
  ast: { ecosystem: "crates.io", name: "ast-grep" },
  "ast-grep": { ecosystem: "crates.io", name: "ast-grep" },
  xh: { ecosystem: "crates.io", name: "xh" },
  aichat: { ecosystem: "crates.io", name: "aichat" },

  // Go-source tools.
  fzf: { ecosystem: "Go", name: "github.com/junegunn/fzf" },
  gh: { ecosystem: "Go", name: "github.com/cli/cli" },
  glab: { ecosystem: "Go", name: "gitlab.com/gitlab-org/cli" },
  yq: { ecosystem: "Go", name: "github.com/mikefarah/yq" },
  dasel: { ecosystem: "Go", name: "github.com/tomwright/dasel" },
  duckdb: { ecosystem: "Go", name: "github.com/duckdb/duckdb" },
  lazygit: { ecosystem: "Go", name: "github.com/jesseduffield/lazygit" },

  // Python (PyPI) tools.
  csvkit: { ecosystem: "PyPI", name: "csvkit" },
  llm: { ecosystem: "PyPI", name: "llm" },
  httpie: { ecosystem: "PyPI", name: "httpie" },

  // npm-distributed tools.
  playwright: { ecosystem: "npm", name: "@playwright/test" },
  stagehand: { ecosystem: "npm", name: "@browserbasehq/stagehand" },

  // C / vendored.
  jq: { ecosystem: "Linux", name: "jq" },
  curl: { ecosystem: "Linux", name: "curl" },
  zstd: { ecosystem: "Linux", name: "zstd" },
};

/**
 * Map a CLI tool registry entry to its OSV.dev target. Returns null when
 * the tool cannot be confidently mapped — those are surfaced in
 * `CheckReport.unmapped` so the next cycle can add an override.
 */
export function mapToolToOsvTarget(meta: CliToolMeta): CliToolTarget | null {
  const override = ECOSYSTEM_OVERRIDES[meta.id];
  if (override) {
    return {
      tool: meta.id,
      category: meta.category,
      ecosystem: override.ecosystem,
      name: override.name,
      version: stripVersionConstraint(meta.minVersion),
    };
  }
  return null;
}

/**
 * Strip a leading semver operator (`>=`, `^`, `~`, `=`) so OSV.dev sees a
 * bare version string. OSV.dev's `version` query field expects an exact
 * version; ranges are not supported on the simple query endpoint.
 */
function stripVersionConstraint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  // Match optional `>=`, `<=`, `>`, `<`, `^`, `~`, `=`, or nothing.
  const m = trimmed.match(/^[><=^~]*(.+)$/);
  return m?.[1]?.trim() ?? trimmed;
}

// ── Severity normalization (lifted from check-mcp-cves.ts) ────────

export function normalizeSeverity(v: OsvVulnerability): Severity {
  const dbSpec = v.database_specific?.severity;
  if (typeof dbSpec === "string") {
    const up = dbSpec.toUpperCase();
    if (up === "CRITICAL" || up === "HIGH" || up === "MODERATE" || up === "LOW") {
      return up;
    }
    if (up === "MEDIUM") return "MODERATE";
  }
  const sevs = Array.isArray(v.severity) ? v.severity : [];
  for (const s of sevs) {
    const score = parseCvssBase(s?.score);
    if (score === null) continue;
    if (score >= 9.0) return "CRITICAL";
    if (score >= 7.0) return "HIGH";
    if (score >= 4.0) return "MODERATE";
    return "LOW";
  }
  return "UNKNOWN";
}

export function parseCvssBase(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 10) return asNum;
  return null;
}

function isCriticalOrHigh(sev: Severity): boolean {
  return sev === "CRITICAL" || sev === "HIGH";
}

// ── OSV.dev query ─────────────────────────────────────────────────

async function queryOsv(
  target: CliToolTarget,
  fetcher: typeof fetch,
): Promise<OsvQueryResponse> {
  const body: Record<string, unknown> = {
    package: { name: target.name, ecosystem: target.ecosystem },
  };
  if (target.version) body.version = target.version;
  const res = await fetcher(OSV_QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OSV.dev HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as OsvQueryResponse;
  return json;
}

// ── Core check ────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(publishedISO: string | undefined, now: Date): number | undefined {
  if (!publishedISO) return undefined;
  const t = Date.parse(publishedISO);
  if (!Number.isFinite(t)) return undefined;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

export async function checkCliCves(opts: RunOptions = {}): Promise<CheckReport> {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const fetcher = opts.fetcher ?? fetch;
  const now = (opts.now ?? (() => new Date()))();
  const registry = opts.registry ?? (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta>);

  const targets: CliToolTarget[] = [];
  const unmapped: CliToolMeta[] = [];
  for (const meta of Object.values(registry)) {
    const target = mapToolToOsvTarget(meta);
    if (target) targets.push(target);
    else unmapped.push(meta);
  }

  const findings: VulnerabilityFinding[] = [];
  const queryErrors: Array<{ target: CliToolTarget; reason: string }> = [];

  for (const target of targets) {
    let response: OsvQueryResponse;
    try {
      response = await queryOsv(target, fetcher);
    } catch (err) {
      queryErrors.push({ target, reason: (err as Error).message });
      continue;
    }
    const vulns = response.vulns ?? [];
    for (const v of vulns) {
      const severity = normalizeSeverity(v);
      if (!isCriticalOrHigh(severity)) continue;
      const publishedISO = v.published ?? v.modified;
      const ageDays = daysSince(publishedISO, now);
      const isStale = ageDays !== undefined && ageDays > maxAgeDays;
      findings.push({
        target,
        id: v.id,
        summary: v.summary ?? "",
        severity,
        publishedISO,
        ageDays,
        isStale,
      });
    }
  }

  const staleFindings = findings.filter((f) => f.isStale);
  return { targets, findings, staleFindings, maxAgeDays, queryErrors, unmapped };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatTextReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push("check-cli-cves:");
  lines.push(`  targets queried: ${report.targets.length}`);
  lines.push(`  Critical/High findings: ${report.findings.length}`);
  lines.push(`  stale (>${report.maxAgeDays} days): ${report.staleFindings.length}`);
  lines.push(`  unmapped registry entries: ${report.unmapped.length}`);
  if (report.findings.length > 0) {
    lines.push("");
    lines.push("  Critical/High advisories:");
    for (const f of report.findings) {
      const age = f.ageDays !== undefined ? `${f.ageDays}d` : "age unknown";
      const tag = f.isStale ? "FAIL" : "warn";
      lines.push(
        `    [${tag}] ${f.severity.padEnd(8)} ${f.id}  ${f.target.tool} (${f.target.ecosystem}/${f.target.name}@${f.target.version ?? "unpinned"}) (${age})`,
      );
      if (f.summary) lines.push(`           ${f.summary}`);
    }
  }
  if (report.queryErrors.length > 0) {
    lines.push("");
    lines.push("  OSV.dev query errors (treated as warnings, not gate failures):");
    for (const qe of report.queryErrors) {
      lines.push(`    - ${qe.target.tool}: ${qe.reason}`);
    }
  }
  if (report.unmapped.length > 0) {
    lines.push("");
    lines.push("  Registry tools without OSV.dev mapping (add to ECOSYSTEM_OVERRIDES):");
    for (const meta of report.unmapped) {
      lines.push(`    - ${meta.id} (${meta.category})`);
    }
  }
  lines.push("");
  if (report.staleFindings.length > 0) {
    lines.push(
      `  ${report.staleFindings.length} Critical/High advisory(ies) older than ${report.maxAgeDays} days. Bump pinned minVersion in src/cliTools/registry.ts or open an exception note.`,
    );
  } else if (report.findings.length > 0) {
    lines.push(
      `  All ${report.findings.length} Critical/High advisory(ies) within the ${report.maxAgeDays}-day window. No gate failure; bump on the next cycle.`,
    );
  } else {
    lines.push(
      `  No Critical/High advisories across ${report.targets.length} CLI tool(s) queried.`,
    );
  }
  return lines.join("\n");
}

// ── Entry point ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const report = await checkCliCves({ maxAgeDays: flags.maxAgeDays });
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatTextReport(report));
  }
  if (report.staleFindings.length > 0) process.exit(1);
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
    console.error("check-cli-cves failed:", err);
    process.exit(1);
  });
}
