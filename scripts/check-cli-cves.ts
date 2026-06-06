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
  /**
   * True when the registry `securityNote` cites a concrete advisory id
   * (`CVE-YYYY-NNNN` or `GHSA-xxxx-xxxx-xxxx`) — a falsifiable claim that a
   * published Critical/High advisory exists for this tool. Such a target is
   * expected to either surface a Critical/High OSV finding, raise a query
   * error, or be explicitly acknowledged in {@link VACUOUS_ACK}; a clean
   * 0-row OSV response that is none of those is a vacuous certification and
   * fails the gate closed (CD11). Notes that document only install-channel
   * hygiene or peer-dependency trust (no advisory id) set this `false` —
   * OSV correctly returns no rows for "the install script is unsigned", so
   * those are NOT vacuous. See {@link CheckReport.vacuousCertifications}.
   */
  citesAdvisoryId: boolean;
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
  /**
   * True when the advisory id is in ACKNOWLEDGED_ADVISORIES — a Critical/High
   * advisory with no upstream fix that is reported but excluded from the gate.
   */
  acknowledged: boolean;
}

/**
 * An OSV record whose severity could not be scored — `normalizeSeverity`
 * returned UNKNOWN because the record carried neither `database_specific.severity`
 * nor a parseable numeric CVSS base. Common for Go-ecosystem `GO-####` records
 * (the docker/podman/dasel blind spot, SA15.7-F1). Surfaced for manual review
 * so an unscored HIGH is never silently dropped, but non-gating (an UNKNOWN
 * severity is not a Critical/High signal).
 */
export interface UnscoredAdvisory {
  target: CliToolTarget;
  id: string;
  summary: string;
  publishedISO?: string;
  ageDays?: number;
}

/** A tool exempted from OSV scanning, paired with its documented reason. */
export interface ExemptedTool {
  meta: CliToolMeta;
  reason: string;
}

export interface CheckReport {
  targets: CliToolTarget[];
  findings: VulnerabilityFinding[];
  /** Stale Critical/High findings that trip the gate (acknowledged excluded). */
  staleFindings: VulnerabilityFinding[];
  /** Findings whose advisory id is acknowledged (reported, never gating). */
  acknowledgedFindings: VulnerabilityFinding[];
  maxAgeDays: number;
  queryErrors: Array<{ target: CliToolTarget; reason: string }>;
  /** Tools the registry could not map to an OSV.dev ecosystem. */
  unmapped: CliToolMeta[];
  /** Tools intentionally not OSV-scanned (documented in SCAN_EXEMPT_TOOLS). */
  exempted: ExemptedTool[];
  /**
   * OSV records that returned but could not be severity-scored (UNKNOWN) —
   * the GO-record blind spot (SA15.7-F1). Surfaced for manual review so an
   * unscored HIGH is never silently dropped; non-gating (UNKNOWN is not a
   * Critical/High signal). A non-empty list for an advisory-citing tool is the
   * "queried but coordinate/severity unconfirmed" signal that distinguishes a
   * wrong-coordinate or unscored result from a genuinely clean one (SA21.7-F3).
   */
  unscoredAdvisories: UnscoredAdvisory[];
  /**
   * CD11 fail-closed guard. Targets whose `securityNote` cites a concrete
   * advisory id (CVE/GHSA) yet whose OSV query returned zero Critical/High
   * findings, raised no query error, AND are not listed in {@link VACUOUS_ACK}
   * — a structurally vacuous "clean" result that means the OSV
   * ecosystem/name/version mapping cannot corroborate an advisory hatch3r
   * documents. Non-empty -> exit 1, exactly like `staleFindings`: a gate that
   * certifies a tool clean while the registry names a specific CVE for it is
   * fail-open, and CD11 requires the gate to fail closed on a 0-row result for
   * a known-present advisory. Install-hygiene notes (no advisory id) never
   * appear here; a documented expected-0-rows tool (patched at the pinned
   * version, or an OSV-unsurfaceable record) is acknowledged in VACUOUS_ACK
   * and surfaced in {@link acknowledgedVacuous} instead.
   */
  vacuousCertifications: CliToolTarget[];
  /**
   * Advisory-citing targets with a 0-row OSV result whose expected-0-rows
   * status is documented in VACUOUS_ACK (e.g. fixed at the pinned version, or
   * an OSV GO-record without numeric severity). Reported for transparency,
   * never gating — the counterpart to {@link acknowledgedFindings}.
   */
  acknowledgedVacuous: CliToolTarget[];
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
  // Go-module OSV coordinates MUST carry the upstream module's major-version
  // suffix (`/vN`) once the module is on v2+ — OSV.dev keys post-v1 Go modules
  // by the import path including `/vN` (semantic-import-versioning), so a base
  // path silently matches only the v0/v1 record set and drops the vN advisory
  // cluster (D21-SA21.3-F1 / SA21.7-F3, dasel + yq). Every entry below was
  // re-checked against pkg.go.dev for its current major: gh (cli/cli is still
  // v2 but publishes under the bare module path), glab, fzf, mods, lazygit,
  // duckdb, moby/moby (v1 path) carry no `/vN`; dasel (v3), yq (v4),
  // podman (v5), miller (v6) do.
  fzf: { ecosystem: "Go", name: "github.com/junegunn/fzf" },
  gh: { ecosystem: "Go", name: "github.com/cli/cli" },
  glab: { ecosystem: "Go", name: "gitlab.com/gitlab-org/cli" },
  yq: { ecosystem: "Go", name: "github.com/mikefarah/yq/v4" },
  dasel: { ecosystem: "Go", name: "github.com/tomwright/dasel/v3" },
  duckdb: { ecosystem: "Go", name: "github.com/duckdb/duckdb" },
  lazygit: { ecosystem: "Go", name: "github.com/jesseduffield/lazygit" },
  // docker + podman: several of their advisories arrive from OSV as
  // Go-ecosystem `GO-####` records WITHOUT a numeric CVSS or
  // `database_specific.severity`, so `normalizeSeverity` classifies them
  // UNKNOWN. They never reach the Critical/High finding path. Rather than be
  // dropped silently (the SA15.7-F1 blind spot), every UNKNOWN-severity record
  // is now surfaced in `CheckReport.unscoredAdvisories` ("unscored — manual
  // review required") so a GO-record HIGH (e.g. docker CVE-2026-34040 =
  // GO-2026-4887, GHSA-x744-4wpc-v9h2) is visible for manual triage instead of
  // vanishing. The fixed-at-the-pin status is tracked in VACUOUS_ACK and the
  // CVE ids are cited in each tool's registry `securityNote`.
  docker: { ecosystem: "Go", name: "github.com/moby/moby" },
  podman: { ecosystem: "Go", name: "github.com/containers/podman/v5" },
  mods: { ecosystem: "Go", name: "github.com/charmbracelet/mods" },
  miller: { ecosystem: "Go", name: "github.com/johnkerl/miller/v6" },
  "container-use": { ecosystem: "Go", name: "github.com/dagger/container-use" },

  // Python (PyPI) tools.
  csvkit: { ecosystem: "PyPI", name: "csvkit" },
  llm: { ecosystem: "PyPI", name: "llm" },
  httpie: { ecosystem: "PyPI", name: "httpie" },
  // az-devops is intentionally NOT mapped here — it is exempted in
  // SCAN_EXEMPT_TOOLS (D21-SA21.5-F3). The az CLI azure-devops extension ships
  // as an az `.whl`, not a public package; the unrelated PyPI `azure-devops`
  // project is the 7.x Azure DevOps REST SDK (5.0.0b1..7.1.0b4, no 1.0.x), so
  // querying it at the pinned extension version (1.0.4) version-mismatches and
  // returns a vacuous clean result.

  // npm-distributed tools.
  playwright: { ecosystem: "npm", name: "@playwright/test" },
  stagehand: { ecosystem: "npm", name: "@browserbasehq/stagehand" },

  // C / vendored.
  jq: { ecosystem: "Linux", name: "jq" },
  curl: { ecosystem: "Linux", name: "curl" },
  zstd: { ecosystem: "Linux", name: "zstd" },
};

/**
 * Tools intentionally NOT OSV-scanned (no clean ecosystem target). Keyed by
 * registry id -> reason. They are reported separately (the `exempted` bucket),
 * never as "unmapped" — an exemption is a documented decision, an unmapped
 * entry is an unfilled gap.
 */
const SCAN_EXEMPT_TOOLS: Record<string, string> = {
  rtk: "crates.io 'rtk' is an unrelated project; rtk-ai/rtk ships only via git/Homebrew/scoop install scripts — no OSV advisory package",
  comby: "comby-tools/comby ships only as a GitHub-release binary / opam — no npm/Go/PyPI/crates OSV advisory package",
  // D21-SA21.5-F3: the az `azure-devops` CLI extension ships as an az `.whl`,
  // not a public package. The PyPI `azure-devops` project is the unrelated 7.x
  // Azure DevOps REST SDK (5.0.0b1..7.1.0b4, no 1.0.x), so a query pinned to
  // the extension version (1.0.4) version-mismatches and returns a vacuous
  // clean result. Re-map (name AND an existing version) only if a real OSV
  // coordinate for the extension is found.
  "az-devops": "az `azure-devops` extension ships as an az `.whl`, not a public package; PyPI `azure-devops` is the unrelated 7.x Azure DevOps REST SDK — no version-matched OSV advisory coordinate",
};

/**
 * Critical/High advisories explicitly acknowledged (no upstream fix available).
 * Acknowledged ids are still REPORTED (with reason) but do NOT fail the gate.
 * Review each by its reviewBy date.
 */
const ACKNOWLEDGED_ADVISORIES: Record<
  string,
  { reason: string; addedISO: string; reviewBy: string }
> = {
  "GHSA-g76p-4vg5-f4qh": {
    reason:
      "llm --functions code-injection is by-design (arbitrary Python via a user-invoked flag); OSV lists no upstream fix. Mitigation: never pass untrusted input to `llm --functions`.",
    addedISO: "2026-06-03",
    reviewBy: "2026-09-01",
  },
};

/**
 * Concrete advisory-id matcher: a `CVE-YYYY-NNNN` or `GHSA-xxxx-xxxx-xxxx`
 * token. Used to decide whether a `securityNote` makes a falsifiable
 * advisory claim (OSV is then expected to corroborate it) versus documenting
 * only install-channel hygiene / peer-dependency trust (no OSV row expected).
 */
const ADVISORY_ID_RE = /\b(?:CVE-\d{4}-\d{3,}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/i;

/**
 * Returns true when `note` cites at least one concrete CVE/GHSA id.
 */
export function securityNoteCitesAdvisoryId(note: string | undefined): boolean {
  return typeof note === "string" && ADVISORY_ID_RE.test(note);
}

/**
 * CD11 vacuous-certification acknowledgments. A tool whose `securityNote`
 * cites a concrete advisory id, yet for which a 0-row Critical/High OSV result
 * is *expected and explained*, is listed here so it does NOT trip the
 * fail-closed gate — while any NEW advisory-citing tool that returns 0 rows
 * (an un-reviewed mapping gap) still fails closed. Keyed by registry tool id.
 * Each entry is reviewed by its reviewBy date; an overdue review is surfaced
 * in the report. This mirrors {@link ACKNOWLEDGED_ADVISORIES} but operates at
 * the tool-target level (the reason is "why OSV legitimately returns 0 for the
 * version we pin", not "this specific advisory has no fix").
 */
const VACUOUS_ACK: Record<string, { reason: string; addedISO: string; reviewBy: string }> = {
  gh: {
    reason:
      "CVE-2026-48501 / GHSA-8xvp-7hj6-mcj9 (Authorization-header leak to TUF mirrors) is fixed in gh 2.93.0; the registry pins minVersion >=2.93.0, so OSV correctly returns no Critical/High advisory for the pinned (patched) version. The also-cited CVE-2026-45803 / GHSA-crc3-h8v6-qh57 is a LOW escape-injection (fixed 2.92.0) and never reaches the Critical/High path.",
    addedISO: "2026-06-06",
    reviewBy: "2026-09-06",
  },
  curl: {
    reason:
      "CVE-2026-7168/7009/6429/6253/6276/3805/3783 are all Medium-and-Low (credential-leak / connection-reuse) per the registry securityNote and are fixed in curl 8.20.0 (pinned minVersion); OSV surfaces no Critical/High row for the pinned version, which is the correct gate-clean result.",
    addedISO: "2026-06-05",
    reviewBy: "2026-09-05",
  },
  docker: {
    reason:
      "CVE-2026-41567/41568/42306 are fixed in 29.5.2 (pinned minVersion). OSV returns these moby/moby advisories as Go-ecosystem records without a numeric severity (the documented GO-record blind spot in ECOSYSTEM_OVERRIDES), so they normalize to UNKNOWN and never reach Critical/High even for affected versions; the host-root-escape risk is tracked in the registry securityNote.",
    addedISO: "2026-06-05",
    reviewBy: "2026-09-05",
  },
  podman: {
    reason:
      "CVE-2026-33414 (Windows-only Hyper-V escape) is fixed in podman 5.8.2 (pinned minVersion) and arrives from OSV as a Go-ecosystem record without numeric severity (the documented GO-record blind spot); a 0-row Critical/High result for the patched version is correct, and the risk is tracked in the registry securityNote.",
    addedISO: "2026-06-05",
    reviewBy: "2026-09-05",
  },
  dasel: {
    reason:
      "CVE-2026-46377/46378/33320 are all fixed in dasel 3.11.0; the registry pins minVersion >=3.11.0 and the OSV coordinate carries the `/v3` major suffix, so OSV correctly returns no Critical/High advisory for the pinned (patched) version.",
    addedISO: "2026-06-05",
    reviewBy: "2026-09-05",
  },
  playwright: {
    reason:
      "CVE-2025-59288 (installer MitM in `npx playwright install`) is fixed in @playwright/test 1.55.1; the registry pins minVersion >=1.55.1, so OSV correctly returns no Critical/High advisory for the pinned version. The also-cited CVE-2026-2441 is a Chromium CSS use-after-free not keyed under the npm @playwright/test coordinate (it lives in the bundled browser engine, rolled per monthly playwright release), so OSV surfaces no npm-package row for it either — both 0-row outcomes are correct, with the browser-engine roll tracked in the registry securityNote.",
    addedISO: "2026-06-06",
    reviewBy: "2026-09-06",
  },
  llm: {
    reason:
      "GHSA-g76p-4vg5-f4qh (`llm --functions` arbitrary-Python code-injection) is by-design with no upstream fix — also in ACKNOWLEDGED_ADVISORIES. OSV returns no scored Critical/High row for the PyPI `llm` package at any version, so a 0-row Critical/High result is the correct gate-clean outcome; the risk is surfaced verbatim in the registry securityNote and the cli-toolbox skill.",
    addedISO: "2026-06-06",
    reviewBy: "2026-09-01",
  },
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
      citesAdvisoryId: securityNoteCitesAdvisoryId(meta.securityNote),
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
  const exempted: ExemptedTool[] = [];
  for (const meta of Object.values(registry)) {
    const exemptReason = SCAN_EXEMPT_TOOLS[meta.id];
    if (exemptReason !== undefined) {
      // Documented no-scan decision: report separately, never query, never
      // count as unmapped.
      exempted.push({ meta, reason: exemptReason });
      continue;
    }
    const target = mapToolToOsvTarget(meta);
    if (target) targets.push(target);
    else unmapped.push(meta);
  }

  const findings: VulnerabilityFinding[] = [];
  const unscoredAdvisories: UnscoredAdvisory[] = [];
  const queryErrors: Array<{ target: CliToolTarget; reason: string }> = [];
  // CD11: track which advisory-citing targets actually produced a Critical/High
  // hit or a query error. An advisory-citing target that did neither returned a
  // structurally vacuous "clean" response and fails the gate closed (unless it
  // is explicitly acknowledged in VACUOUS_ACK).
  const producedSignal = new Set<string>();

  for (const target of targets) {
    let response: OsvQueryResponse;
    try {
      response = await queryOsv(target, fetcher);
    } catch (err) {
      queryErrors.push({ target, reason: (err as Error).message });
      // A query error is a non-vacuous outcome — we could not certify the tool
      // clean, so it is not a silent fail-open. Mark it as having produced a
      // signal so it is not double-counted as a vacuous certification.
      producedSignal.add(target.tool);
      continue;
    }
    const vulns = response.vulns ?? [];
    for (const v of vulns) {
      const severity = normalizeSeverity(v);
      if (severity === "UNKNOWN") {
        // SA15.7-F1: a returned record OSV could not score (no
        // database_specific.severity, no parseable CVSS). Surface it for
        // manual review instead of dropping it silently — a GO-record HIGH
        // would otherwise vanish. Non-gating, but it is a real signal that the
        // query hit something, so the target is not treated as a vacuous
        // 0-row certification.
        producedSignal.add(target.tool);
        const unscoredPublishedISO = v.published ?? v.modified;
        unscoredAdvisories.push({
          target,
          id: v.id,
          summary: v.summary ?? "",
          publishedISO: unscoredPublishedISO,
          ageDays: daysSince(unscoredPublishedISO, now),
        });
        continue;
      }
      if (!isCriticalOrHigh(severity)) continue;
      producedSignal.add(target.tool);
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
        acknowledged: ACKNOWLEDGED_ADVISORIES[v.id] !== undefined,
      });
    }
  }

  // Acknowledged advisories are reported but never gate: a stale acknowledged
  // finding is excluded from staleFindings so the documented no-fix advisory
  // does not fail the build.
  const staleFindings = findings.filter((f) => f.isStale && !f.acknowledged);
  const acknowledgedFindings = findings.filter((f) => f.acknowledged);
  // CD11 fail-closed: a target whose securityNote cites a concrete CVE/GHSA id
  // yet yielded zero Critical/High findings and no query error is a vacuous
  // certification — OSV could not corroborate the documented advisory, so the
  // gate cannot honestly report the tool clean. Targets whose expected 0-row
  // result is documented in VACUOUS_ACK are carried (reported, not gating);
  // any other advisory-citing 0-row target fails closed.
  const candidateVacuous = targets.filter(
    (t) => t.citesAdvisoryId && !producedSignal.has(t.tool),
  );
  const vacuousCertifications = candidateVacuous.filter((t) => VACUOUS_ACK[t.tool] === undefined);
  const acknowledgedVacuous = candidateVacuous.filter((t) => VACUOUS_ACK[t.tool] !== undefined);
  return {
    targets,
    findings,
    staleFindings,
    acknowledgedFindings,
    maxAgeDays,
    queryErrors,
    unmapped,
    exempted,
    unscoredAdvisories,
    vacuousCertifications,
    acknowledgedVacuous,
  };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatTextReport(report: CheckReport, now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push("check-cli-cves:");
  lines.push(`  targets queried: ${report.targets.length}`);
  lines.push(`  Critical/High findings: ${report.findings.length}`);
  lines.push(`  stale (>${report.maxAgeDays} days): ${report.staleFindings.length}`);
  lines.push(`  acknowledged (reported, not gating): ${report.acknowledgedFindings.length}`);
  lines.push(`  unscored advisories (UNKNOWN severity, manual review, not gating): ${report.unscoredAdvisories.length}`);
  lines.push(`  vacuous certifications (advisory-citing tool, 0 OSV hits, gating): ${report.vacuousCertifications.length}`);
  lines.push(`  acknowledged vacuous (advisory-citing, expected 0 OSV hits, not gating): ${report.acknowledgedVacuous.length}`);
  lines.push(`  unmapped registry entries: ${report.unmapped.length}`);
  lines.push(`  exempted (intentionally not OSV-scanned): ${report.exempted.length}`);
  if (report.findings.length > 0) {
    lines.push("");
    lines.push("  Critical/High advisories:");
    for (const f of report.findings) {
      const age = f.ageDays !== undefined ? `${f.ageDays}d` : "age unknown";
      // Acknowledged advisories render [ack] (no FAIL/warn) — they are reported
      // for visibility but excluded from the gate by construction.
      const tag = f.acknowledged ? "ack" : f.isStale ? "FAIL" : "warn";
      lines.push(
        `    [${tag}] ${f.severity.padEnd(8)} ${f.id}  ${f.target.tool} (${f.target.ecosystem}/${f.target.name}@${f.target.version ?? "unpinned"}) (${age})`,
      );
      if (f.summary) lines.push(`           ${f.summary}`);
      if (f.acknowledged) {
        const ack = ACKNOWLEDGED_ADVISORIES[f.id];
        if (ack) {
          lines.push(`           acknowledged: ${ack.reason}`);
          lines.push(`           added ${ack.addedISO}, review by ${ack.reviewBy}`);
          if (Date.parse(ack.reviewBy) < now.getTime()) {
            lines.push(
              `           review overdue (reviewBy ${ack.reviewBy} has passed) — re-verify the no-fix status`,
            );
          }
        }
      }
    }
  }
  if (report.queryErrors.length > 0) {
    lines.push("");
    lines.push("  OSV.dev query errors (treated as warnings, not gate failures):");
    for (const qe of report.queryErrors) {
      lines.push(`    - ${qe.target.tool}: ${qe.reason}`);
    }
  }
  if (report.unscoredAdvisories.length > 0) {
    lines.push("");
    lines.push(
      "  Unscored advisories (OSV returned a record with no severity — manual review required; not gating; common for Go GO-#### records, the docker/podman/dasel blind spot):",
    );
    for (const u of report.unscoredAdvisories) {
      const age = u.ageDays !== undefined ? `${u.ageDays}d` : "age unknown";
      lines.push(
        `    [review] ${u.id}  ${u.target.tool} (${u.target.ecosystem}/${u.target.name}@${u.target.version ?? "unpinned"}) (${age})`,
      );
      if (u.summary) lines.push(`             ${u.summary}`);
    }
  }
  if (report.vacuousCertifications.length > 0) {
    lines.push("");
    lines.push(
      "  Vacuous certifications (securityNote cites a CVE/GHSA but OSV returned 0 Critical/High — gate FAILS closed; fix the ECOSYSTEM_OVERRIDES mapping so the advisory surfaces, or add the tool to VACUOUS_ACK with a documented expected-0-rows reason):",
    );
    for (const t of report.vacuousCertifications) {
      lines.push(
        `    [FAIL] ${t.tool} (${t.ecosystem}/${t.name}@${t.version ?? "unpinned"}) — securityNote cites a concrete advisory id, but OSV.dev returned no Critical/High match`,
      );
    }
  }
  if (report.acknowledgedVacuous.length > 0) {
    lines.push("");
    lines.push(
      "  Acknowledged vacuous (advisory-citing tools with an expected 0-row OSV result, see VACUOUS_ACK — reported, not gating):",
    );
    for (const t of report.acknowledgedVacuous) {
      const ack = VACUOUS_ACK[t.tool];
      lines.push(
        `    [ack] ${t.tool} (${t.ecosystem}/${t.name}@${t.version ?? "unpinned"})`,
      );
      if (ack) {
        lines.push(`           ${ack.reason}`);
        lines.push(`           added ${ack.addedISO}, review by ${ack.reviewBy}`);
        if (Date.parse(ack.reviewBy) < now.getTime()) {
          lines.push(
            `           review overdue (reviewBy ${ack.reviewBy} has passed) — re-verify the expected-0-rows status`,
          );
        }
      }
    }
  }
  if (report.unmapped.length > 0) {
    lines.push("");
    lines.push("  Registry tools without OSV.dev mapping (add to ECOSYSTEM_OVERRIDES):");
    for (const meta of report.unmapped) {
      lines.push(`    - ${meta.id} (${meta.category})`);
    }
  }
  if (report.exempted.length > 0) {
    lines.push("");
    lines.push("  Exempted (intentionally not OSV-scanned, see SCAN_EXEMPT_TOOLS):");
    for (const ex of report.exempted) {
      lines.push(`    - ${ex.meta.id} (${ex.meta.category}): ${ex.reason}`);
    }
  }
  lines.push("");
  // CD11: a vacuous certification fails the gate independently of staleness —
  // emit its failure line first so a known-advisory tool with a broken OSV
  // mapping is never masked by an otherwise-clean advisory summary.
  if (report.vacuousCertifications.length > 0) {
    lines.push(
      `  ${report.vacuousCertifications.length} known-advisory tool(s) returned 0 Critical/High OSV matches (vacuous certification — gate FAILS closed). Each tool above carries a registry securityNote; fix its ECOSYSTEM_OVERRIDES mapping (ecosystem/name/version) so the documented advisory surfaces, or add the advisory id to ACKNOWLEDGED_ADVISORIES.`,
    );
  }
  const gatingFindings = report.findings.length - report.acknowledgedFindings.length;
  if (report.staleFindings.length > 0) {
    lines.push(
      `  ${report.staleFindings.length} Critical/High advisory(ies) older than ${report.maxAgeDays} days (acknowledged advisories excluded). Bump pinned minVersion in src/cliTools/registry.ts or open an exception note.`,
    );
  } else if (gatingFindings > 0) {
    lines.push(
      `  All ${gatingFindings} gating Critical/High advisory(ies) within the ${report.maxAgeDays}-day window. No gate failure; bump on the next cycle.`,
    );
  } else if (report.acknowledgedFindings.length > 0) {
    lines.push(
      `  No gating Critical/High advisories across ${report.targets.length} CLI tool(s) queried (${report.acknowledgedFindings.length} acknowledged advisory(ies) reported above, excluded from the gate).`,
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
  const now = new Date();
  const report = await checkCliCves({ maxAgeDays: flags.maxAgeDays, now: () => now });
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatTextReport(report, now));
  }
  // CD11: fail closed on a vacuous certification (known-advisory tool with a
  // 0-row OSV result) as well as on a stale gating advisory.
  if (report.staleFindings.length > 0 || report.vacuousCertifications.length > 0) {
    process.exit(1);
  }
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
