#!/usr/bin/env node
/**
 * scripts/check-mcp-deprecation.ts — Pillars P6 (Security & Trust),
 * P3 (Adapter & External Tool Currency).
 *
 * Forward registry-health gate over the bundled MCP launcher packages
 * (`npx -y <pkg>@<ver>` entries discovered from `mcp/*.json`). Two axes:
 *
 *   1. Deprecation (FAIL): `npm view <pkg>@<ver> deprecated` for every
 *      pinned launcher. A non-empty deprecation string exits 1 — the pin
 *      is deprecated/archived upstream and must be re-pinned or replaced.
 *   2. Currency (WARN, never fails): compare each pin against
 *      `dist-tags.latest`; warn when the pin is a full major behind, more
 *      than one minor behind, or its published version is more than
 *      `--max-days` (default 90) older than the latest release.
 *
 * Rationale (D15-SA15.5-02): the only prior automated MCP-package gate,
 * `scripts/check-mcp-cves.ts` (`npm run mcp:cve-check`), queries OSV.dev
 * for CVEs — it never calls `npm view deprecated`, so a bundled package
 * newly deprecated AFTER a cycle ships is invisible to it, and the sole
 * deprecation guard (`src/__tests__/mcp/mcp-package-resolution.test.ts`)
 * is a backward-looking static name-lock, not a forward sweep. This gate
 * closes that gap: it discovers packages the same way the CVE gate does
 * (`discoverMcpPackages`, imported below — no duplicated discovery) and
 * adds the missing deprecation + currency probes. Mirrors the CVE gate's
 * network policy: transient `npm view` failures surface as warnings
 * (queryErrors), not gate failures. Wired into CI beside `mcp:cve-check`
 * (`.github/workflows/ci.yml`); kept out of the offline `npm run validate`
 * for the same reason the CVE gate is — it requires a network call.
 *
 * Usage:
 *   `npm run mcp:deprecation-check`
 *   `tsx scripts/check-mcp-deprecation.ts --json`
 *   `tsx scripts/check-mcp-deprecation.ts --max-days 90`
 *
 * Pillars: P6 (Security & Trust), P3 (Adapter Currency).
 */
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { discoverMcpPackages, type McpPackage } from "./check-mcp-cves.js";

const execFileAsync = promisify(execFile);
const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "mcp");
const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";
const DEFAULT_CURRENCY_MAX_DAYS = 90;
const NPM_VIEW_TIMEOUT_MS = 30_000;
const NPM_VIEW_MAX_BUFFER = 16 * 1024 * 1024; // time maps for old packages can be large
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────

export interface DeprecationFinding {
  pkg: McpPackage;
  /** The upstream deprecation message for the pinned version. */
  message: string;
}

export interface CurrencyWarning {
  pkg: McpPackage;
  /** dist-tags.latest at query time. */
  latest: string;
  /** true when latest is a full major ahead of the pin. */
  majorBehind: boolean;
  /** minors behind within the same major (0 when majorBehind). */
  minorGap: number;
  /** Calendar days between the pinned publish and the latest publish, when both are known. */
  daysBehind?: number;
}

export interface DeprecationReport {
  /** All pinned launcher packages discovered across `mcp/*.json`. */
  packages: McpPackage[];
  /** Deprecated pins — non-empty -> exit 1. */
  deprecated: DeprecationFinding[];
  /** Stale-but-not-deprecated pins — warnings only. */
  currencyWarnings: CurrencyWarning[];
  /** Packages `npm view` errored on; surfaced as warnings, not gate failures. */
  queryErrors: Array<{ pkg: McpPackage; reason: string }>;
  /** Days-behind threshold above which a pin becomes a currency warning. */
  currencyMaxDays: number;
}

export interface RunOptions {
  mcpDir?: string;
  currencyMaxDays?: number;
  /** Override the npm-view resolver (tests pass a stub). */
  viewer?: (pkgSpec: string, field: string) => Promise<unknown>;
}

// ── CLI parsing ───────────────────────────────────────────────────

interface CliFlags {
  currencyMaxDays: number;
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  let currencyMaxDays = DEFAULT_CURRENCY_MAX_DAYS;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-days") {
      const next = argv[i + 1];
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0 || n > 3650) {
        throw new Error(
          `check-mcp-deprecation: --max-days requires a number in [0, 3650], got "${String(next)}"`,
        );
      }
      currencyMaxDays = n;
      i++;
    } else if (a === "--json") {
      json = true;
    }
  }
  return { currencyMaxDays, json };
}

// ── npm view resolver ─────────────────────────────────────────────

/**
 * Resolve a single field from `npm view <pkgSpec> <field> --json`. Returns
 * `undefined` when npm prints nothing (e.g. a non-deprecated package's
 * `deprecated` field). Throws on process/transport failure — callers turn
 * that into a warning, never a gate failure.
 */
async function npmViewField(pkgSpec: string, field: string): Promise<unknown> {
  const { stdout } = await execFileAsync(NPM_BIN, ["view", pkgSpec, field, "--json"], {
    timeout: NPM_VIEW_TIMEOUT_MS,
    maxBuffer: NPM_VIEW_MAX_BUFFER,
  });
  const trimmed = stdout.trim();
  if (trimmed === "") return undefined;
  return JSON.parse(trimmed) as unknown;
}

// ── Version + currency helpers ────────────────────────────────────

interface SemverLike {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse the leading `major.minor.patch` numerics from a version string.
 * Tolerant of date-versions (`2026.1.14`) and prerelease/build suffixes;
 * returns null when the first three dot-segments are not all numeric.
 */
export function parseVersion(raw: string | undefined): SemverLike | null {
  if (!raw) return null;
  const core = raw.trim().split(/[-+]/, 1)[0];
  const parts = core.split(".");
  if (parts.length < 1) return null;
  const nums = parts.slice(0, 3).map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { major: nums[0], minor: nums[1] ?? 0, patch: nums[2] ?? 0 };
}

/**
 * Decide whether a pinned version is stale enough to warn about, given the
 * latest version and (optionally) the days between the two publish dates.
 * Warn when a full major behind, more than one minor behind within the same
 * major, or more than `maxDays` calendar days behind the latest release.
 */
export function isStalePin(
  pinned: string,
  latest: string,
  daysBehind: number | undefined,
  maxDays: number,
): { stale: boolean; majorBehind: boolean; minorGap: number } {
  const p = parseVersion(pinned);
  const l = parseVersion(latest);
  let majorBehind = false;
  let minorGap = 0;
  if (p && l) {
    majorBehind = l.major > p.major;
    minorGap = l.major === p.major ? Math.max(0, l.minor - p.minor) : 0;
  }
  const daysStale = daysBehind !== undefined && daysBehind > maxDays;
  const stale = pinned !== latest && (majorBehind || minorGap > 1 || daysStale);
  return { stale, majorBehind, minorGap };
}

// ── Core check ────────────────────────────────────────────────────

export async function checkMcpDeprecation(opts: RunOptions = {}): Promise<DeprecationReport> {
  const currencyMaxDays = opts.currencyMaxDays ?? DEFAULT_CURRENCY_MAX_DAYS;
  const viewer = opts.viewer ?? npmViewField;

  const packages = await discoverMcpPackages(opts.mcpDir ?? MCP_DIR);
  const deprecated: DeprecationFinding[] = [];
  const currencyWarnings: CurrencyWarning[] = [];
  const queryErrors: Array<{ pkg: McpPackage; reason: string }> = [];

  for (const pkg of packages) {
    // Unpinned launchers (no `@<ver>`) resolve `latest` at runtime — nothing
    // to grade for staleness, and the deprecation of `latest` is upstream's
    // to fix, not a stale-pin signal here.
    if (!pkg.version) continue;

    // Deprecation axis (FAIL): the pinned version specifically.
    try {
      const dep = await viewer(`${pkg.name}@${pkg.version}`, "deprecated");
      if (typeof dep === "string" && dep.trim() !== "") {
        deprecated.push({ pkg, message: dep.trim() });
      }
    } catch (err) {
      queryErrors.push({ pkg, reason: `deprecated: ${(err as Error).message}` });
      continue;
    }

    // Currency axis (WARN): compare the pin against dist-tags.latest.
    try {
      const latestRaw = await viewer(pkg.name, "dist-tags.latest");
      const latest = typeof latestRaw === "string" ? latestRaw : undefined;
      if (!latest || latest === pkg.version) continue;

      let daysBehind: number | undefined;
      try {
        const timeRaw = await viewer(pkg.name, "time");
        if (timeRaw && typeof timeRaw === "object") {
          const times = timeRaw as Record<string, string>;
          const tPinned = Date.parse(times[pkg.version] ?? "");
          const tLatest = Date.parse(times[latest] ?? "");
          if (Number.isFinite(tPinned) && Number.isFinite(tLatest)) {
            daysBehind = Math.floor((tLatest - tPinned) / MS_PER_DAY);
          }
        }
      } catch {
        // time lookup is best-effort; fall through to version-only staleness.
      }

      const { stale, majorBehind, minorGap } = isStalePin(
        pkg.version,
        latest,
        daysBehind,
        currencyMaxDays,
      );
      if (stale) {
        currencyWarnings.push({ pkg, latest, majorBehind, minorGap, daysBehind });
      }
    } catch (err) {
      queryErrors.push({ pkg, reason: `currency: ${(err as Error).message}` });
    }
  }

  return { packages, deprecated, currencyWarnings, queryErrors, currencyMaxDays };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatTextReport(report: DeprecationReport): string {
  const lines: string[] = [];
  lines.push("check-mcp-deprecation:");
  lines.push(`  packages scanned: ${report.packages.length}`);
  lines.push(`  deprecated pins: ${report.deprecated.length}`);
  lines.push(`  currency warnings (>${report.currencyMaxDays}d / >1 minor / major behind): ${report.currencyWarnings.length}`);

  if (report.deprecated.length > 0) {
    lines.push("");
    lines.push("  DEPRECATED pins (gate failure — re-pin or replace):");
    for (const d of report.deprecated) {
      lines.push(`    [FAIL] ${d.pkg.name}@${d.pkg.version ?? "unpinned"}  (${d.pkg.server} in ${d.pkg.sourceFile})`);
      lines.push(`           ${d.message}`);
    }
  }

  if (report.currencyWarnings.length > 0) {
    lines.push("");
    lines.push("  Currency warnings (non-blocking — refresh on the next pack pass):");
    for (const w of report.currencyWarnings) {
      const gap = w.majorBehind
        ? "major behind"
        : w.minorGap > 1
          ? `${w.minorGap} minors behind`
          : "behind";
      const age = w.daysBehind !== undefined ? `, ${w.daysBehind}d older` : "";
      lines.push(`    [warn] ${w.pkg.name}@${w.pkg.version ?? "unpinned"} -> latest ${w.latest} (${gap}${age})`);
    }
  }

  if (report.queryErrors.length > 0) {
    lines.push("");
    lines.push("  npm view query errors (treated as warnings, not gate failures):");
    for (const qe of report.queryErrors) {
      lines.push(`    - ${qe.pkg.name}: ${qe.reason}`);
    }
  }

  lines.push("");
  if (report.deprecated.length > 0) {
    lines.push(
      `  ${report.deprecated.length} bundled MCP pin(s) are deprecated upstream. Re-pin to a maintained version in mcp/mcp.json or replace the server.`,
    );
  } else {
    lines.push(
      `  No deprecated pins among the ${report.packages.length} bundled MCP package(s).`,
    );
  }
  return lines.join("\n");
}

// ── Entry point ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const report = await checkMcpDeprecation({ currencyMaxDays: flags.currencyMaxDays });
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatTextReport(report));
  }
  if (report.deprecated.length > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    const invoked = process.argv[1] ?? "";
    return invoked.endsWith("check-mcp-deprecation.ts") || invoked.endsWith("check-mcp-deprecation.js");
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("check-mcp-deprecation failed:", err);
    process.exit(1);
  });
}
