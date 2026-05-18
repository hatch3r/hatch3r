#!/usr/bin/env node
/**
 * scripts/check-mcp-cves.ts — Pillars P6 (Security & Trust),
 * P3 (Adapter & External Tool Currency).
 *
 * Queries OSV.dev for known vulnerabilities affecting every package
 * identifier declared in `mcp/*.json` (the canonical MCP-server pack).
 * Exits 1 when any Critical or High advisory has been public for more
 * than 30 days against a version we still ship — the same staleness
 * window AUDIT-EXECUTE.md uses for unpatched-CVE gates.
 *
 * Rationale: every MCP server in `mcp/mcp.json` ships as an `npx -y
 * <pkg>@<ver>` launcher, so a published CVE against the pinned version
 * remains live on every install until the pack is bumped. `npm audit`
 * does not see these because the packages are launched on-demand by
 * users, not pulled by `npm ci`. OSV.dev (the Google-maintained
 * open-source vulnerability database; npm ecosystem coverage from the
 * GitHub Advisory Database + the npm advisory feed) gives us a
 * deterministic query for each `<package, version>` pair.
 *
 * Severity sources, in priority order:
 *   1. `database_specific.severity` (string: CRITICAL / HIGH / MODERATE / LOW)
 *   2. CVSS v3 base score from `severity[].score` (>= 9.0 -> CRITICAL,
 *      >= 7.0 -> HIGH, >= 4.0 -> MODERATE, else LOW)
 *
 * URL-based MCP servers (HTTP transport, e.g. the GitHub MCP at
 * `https://api.githubcopilot.com/mcp/`) are skipped — they have no
 * npm package identifier; their CVE surface is the upstream service,
 * not a pinned dependency in this repo.
 *
 * Usage:
 *   `npm run mcp:cve-check`
 *   `tsx scripts/check-mcp-cves.ts --json`
 *   `tsx scripts/check-mcp-cves.ts --max-age-days 30`
 *
 * Pillars: P6 (Security & Trust), P3 (Adapter Currency).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const MCP_DIR = resolve(ROOT, "mcp");

const DEFAULT_MAX_AGE_DAYS = 30;
const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

// ── Types ─────────────────────────────────────────────────────────

export type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface McpPackage {
  /** MCP server name as declared in `mcpServers`. */
  server: string;
  /** Source file (relative to repo root). */
  sourceFile: string;
  /** npm package name (e.g., `@upstash/context7-mcp`). */
  name: string;
  /** Pinned version (e.g., `2.1.1`); undefined when no version was specified. */
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
  pkg: McpPackage;
  id: string;
  summary: string;
  severity: Severity;
  publishedISO?: string;
  ageDays?: number;
  isStale: boolean;
}

export interface CheckReport {
  /** All packages discovered across `mcp/*.json`. */
  packages: McpPackage[];
  /** Findings whose severity normalizes to CRITICAL or HIGH. */
  findings: VulnerabilityFinding[];
  /** Subset of findings older than `maxAgeDays`. Non-empty -> exit 1. */
  staleFindings: VulnerabilityFinding[];
  /** Days threshold above which a Critical/High finding becomes a gate failure. */
  maxAgeDays: number;
  /** Packages OSV.dev returned an HTTP error for; surfaced as warnings. */
  queryErrors: Array<{ pkg: McpPackage; reason: string }>;
}

export interface RunOptions {
  mcpDir?: string;
  maxAgeDays?: number;
  /** Override the global fetch (tests pass a stub). */
  fetcher?: typeof fetch;
  /** Override the wall clock (tests pass a fixed instant). */
  now?: () => Date;
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
          `check-mcp-cves: --max-age-days requires a number in [0, 365], got "${String(next)}"`,
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

// ── MCP package discovery ─────────────────────────────────────────

/**
 * Parse a single mcpServer entry into one McpPackage when it launches an
 * npm package. Recognised shapes:
 *
 *   { command: "npx", args: ["-y", "<pkg>@<ver>", ...] }
 *   { command: "npx", args: ["<pkg>@<ver>", ...] }       // no -y
 *
 * URL-only entries (HTTP transport) return null — no package to scan.
 */
export function extractPackageFromServer(
  server: string,
  sourceFile: string,
  entry: Record<string, unknown>,
): McpPackage | null {
  // URL transport: nothing to scan locally.
  if (typeof entry.url === "string") return null;

  const command = entry.command;
  if (command !== "npx") return null;

  const args = Array.isArray(entry.args) ? (entry.args as unknown[]) : [];
  // First arg that looks like a package spec (skip flags).
  for (const raw of args) {
    if (typeof raw !== "string") continue;
    if (raw.startsWith("-")) continue;
    // Scoped (`@scope/pkg@ver`) vs unscoped (`pkg@ver`). The `@` that
    // separates name from version is the last one when scoped, the only
    // one when unscoped.
    let name = raw;
    let version: string | undefined;
    if (raw.startsWith("@")) {
      const at = raw.indexOf("@", 1);
      if (at !== -1) {
        name = raw.slice(0, at);
        version = raw.slice(at + 1);
      }
    } else {
      const at = raw.indexOf("@");
      if (at !== -1) {
        name = raw.slice(0, at);
        version = raw.slice(at + 1);
      }
    }
    return { server, sourceFile, name, version };
  }
  return null;
}

/**
 * Discover every package identifier across `mcp/*.json`. Returns one
 * entry per (file, server) pair that launches an npm package.
 */
export async function discoverMcpPackages(mcpDir: string): Promise<McpPackage[]> {
  let entries: string[];
  try {
    entries = await readdir(mcpDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const jsonFiles = entries
    .filter((n) => n.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
  const out: McpPackage[] = [];
  for (const fname of jsonFiles) {
    const abs = join(mcpDir, fname);
    const raw = await readFile(abs, "utf-8");
    let parsed: { mcpServers?: Record<string, Record<string, unknown>> };
    try {
      parsed = JSON.parse(raw) as {
        mcpServers?: Record<string, Record<string, unknown>>;
      };
    } catch (err) {
      throw new Error(
        `check-mcp-cves: failed to parse ${fname}: ${(err as Error).message}`,
      );
    }
    const servers = parsed.mcpServers ?? {};
    for (const [name, entry] of Object.entries(servers)) {
      const pkg = extractPackageFromServer(name, `mcp/${fname}`, entry);
      if (pkg) out.push(pkg);
    }
  }
  return out;
}

// ── Severity normalization ────────────────────────────────────────

/**
 * Normalize OSV.dev severity to one of our five buckets. OSV records
 * publish severity inconsistently across ecosystems; we accept either
 * the GitHub-Advisory-style string in `database_specific.severity` or
 * a CVSS v3 base score from `severity[].score`.
 */
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

/**
 * Extract the base score from a CVSS v3 vector string
 * (`CVSS:3.1/AV:N/...`) or a bare numeric string. OSV.dev stores both
 * shapes across different feeds.
 */
export function parseCvssBase(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Bare number ("7.5").
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 10) return asNum;
  // CVSS vector strings don't carry a base score in the vector itself —
  // OSV.dev usually pairs `type: "CVSS_V3"` with `score: "<vector>"`,
  // and the consumer is expected to compute the score. We approximate
  // from severity buckets in `database_specific` first; if we end up
  // here with only a vector, return null and fall through.
  return null;
}

function isCriticalOrHigh(sev: Severity): boolean {
  return sev === "CRITICAL" || sev === "HIGH";
}

// ── OSV.dev query ─────────────────────────────────────────────────

async function queryOsv(
  pkg: McpPackage,
  fetcher: typeof fetch,
): Promise<OsvQueryResponse> {
  const body: Record<string, unknown> = {
    package: { name: pkg.name, ecosystem: "npm" },
  };
  if (pkg.version) body.version = pkg.version;
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

export async function checkMcpCves(opts: RunOptions = {}): Promise<CheckReport> {
  const mcpDir = opts.mcpDir ?? MCP_DIR;
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const fetcher = opts.fetcher ?? fetch;
  const now = (opts.now ?? (() => new Date()))();

  const packages = await discoverMcpPackages(mcpDir);
  const findings: VulnerabilityFinding[] = [];
  const queryErrors: Array<{ pkg: McpPackage; reason: string }> = [];

  for (const pkg of packages) {
    let response: OsvQueryResponse;
    try {
      response = await queryOsv(pkg, fetcher);
    } catch (err) {
      queryErrors.push({ pkg, reason: (err as Error).message });
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
        pkg,
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
  return { packages, findings, staleFindings, maxAgeDays, queryErrors };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatTextReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push("check-mcp-cves:");
  lines.push(`  packages scanned: ${report.packages.length}`);
  lines.push(`  Critical/High findings: ${report.findings.length}`);
  lines.push(`  stale (>${report.maxAgeDays} days): ${report.staleFindings.length}`);
  if (report.packages.length > 0) {
    lines.push("");
    lines.push("  Discovered packages:");
    for (const p of report.packages) {
      const ver = p.version ? `@${p.version}` : "";
      lines.push(`    - ${p.name}${ver}  [${p.server} in ${p.sourceFile}]`);
    }
  }
  if (report.findings.length > 0) {
    lines.push("");
    lines.push("  Critical/High advisories:");
    for (const f of report.findings) {
      const age = f.ageDays !== undefined ? `${f.ageDays}d` : "age unknown";
      const tag = f.isStale ? "FAIL" : "warn";
      lines.push(
        `    [${tag}] ${f.severity.padEnd(8)} ${f.id}  ${f.pkg.name}@${f.pkg.version ?? "unpinned"}  (${age})`,
      );
      if (f.summary) lines.push(`           ${f.summary}`);
    }
  }
  if (report.queryErrors.length > 0) {
    lines.push("");
    lines.push("  OSV.dev query errors (treated as warnings, not gate failures):");
    for (const qe of report.queryErrors) {
      lines.push(`    - ${qe.pkg.name}: ${qe.reason}`);
    }
  }
  lines.push("");
  if (report.staleFindings.length > 0) {
    lines.push(
      `  ${report.staleFindings.length} Critical/High advisory(ies) older than ${report.maxAgeDays} days. Bump pinned versions in mcp/mcp.json or open an exception note.`,
    );
  } else if (report.findings.length > 0) {
    lines.push(
      `  All ${report.findings.length} Critical/High advisory(ies) within the ${report.maxAgeDays}-day window. No gate failure; bump on the next pack refresh.`,
    );
  } else {
    lines.push(
      `  No Critical/High advisories against any of the ${report.packages.length} MCP package(s).`,
    );
  }
  return lines.join("\n");
}

// ── Entry point ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const report = await checkMcpCves({ maxAgeDays: flags.maxAgeDays });
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatTextReport(report));
  }
  if (report.staleFindings.length > 0) process.exit(1);
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
    console.error("check-mcp-cves failed:", err);
    process.exit(1);
  });
}
