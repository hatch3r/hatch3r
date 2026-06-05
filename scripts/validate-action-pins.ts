#!/usr/bin/env node
/**
 * scripts/validate-action-pins.ts — Cycle 11 H D4-3 (D4): Pillars P6 (Security
 * & Trust — supply-chain action pinning), P3 (Adapter & External Tool
 * Currency), P5 (Governance Self-Quality — Silent Failure Contract).
 *
 * Every third-party GitHub Action in `.github/workflows/*.yml` is pinned to a
 * 40-hex commit SHA with a trailing `# <version>` comment so a human can read
 * what the immutable SHA resolves to. D4-3 found that comment drifts silently:
 * dependabot advanced `actions/checkout` and `softprops/action-gh-release`
 * digests across major versions (v4 -> v6.0.2, v2 -> v3.0.0) without rewriting
 * the coarse `# v4` / `# v2` comment, so the human-readable label lied about
 * the pinned code. No gate caught it because nothing resolved the SHA back to
 * a tag and compared.
 *
 * This gate closes that loop. For each `uses: <owner>/<repo>@<sha> # <ver>`
 * line it resolves the SHA via `git ls-remote --tags` and asserts the comment
 * names a tag that actually points at that commit. A `# v4` comment on a SHA
 * whose only tags are `v6.0.2` is a drift error (exit 1).
 *
 * Network policy (mirrors scripts/check-cli-cves.ts): a `git ls-remote`
 * transport failure is a WARNING (resolveErrors bucket), never a gate failure,
 * so a transient github.com outage cannot red an unrelated PR. Only a
 * successfully-resolved SHA whose tag set excludes the comment's version is an
 * error.
 *
 * Out of scope (not a D4-3 comment-vs-SHA mismatch, so not failed here): a
 * floating `@v4`-style ref with no SHA, or a SHA pin with no trailing comment
 * — both are reported at info level for visibility but do not fail the gate.
 *
 * Usage: `npm run validate:action-pins`
 *        `tsx scripts/validate-action-pins.ts`
 *        `tsx scripts/validate-action-pins.ts --json`
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning" | "info";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  line: number;
  message: string;
}

/** One parsed `uses: owner/repo@sha # comment` pin site. */
export interface PinSite {
  file: string;
  line: number;
  owner: string;
  repo: string;
  sha: string;
  /** Trailing comment text after `#`, trimmed (empty string if none). */
  comment: string;
}

export interface RunOptions {
  /** Workflows dir; defaults to `<repo>/.github/workflows`. */
  workflowsDir?: string;
  /**
   * Resolver injected for tests: maps `owner/repo` + sha to the set of tag
   * names pointing at that commit, or null on a transport failure. Defaults to
   * the real `git ls-remote` resolver.
   */
  resolveTags?: (owner: string, repo: string, sha: string) => Promise<string[] | null>;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  checkedSites: number;
}

// ── Parsing ───────────────────────────────────────────────────────

// `uses: owner/repo@<40-hex>` with an optional trailing `# comment`.
// Sub-action paths (`owner/repo/path@sha`) are tolerated by capturing repo up
// to the first `/` or `@`.
const SHA_PIN_RE =
  /^\s*(?:-\s*)?uses:\s*([\w.-]+)\/([\w.-]+)(?:\/[\w./-]+)?@([0-9a-f]{40})\b(?:\s*#\s*(.*?))?\s*$/;

// A `uses:` line that does NOT pin a 40-hex SHA (floating tag/branch ref).
const USES_RE = /^\s*(?:-\s*)?uses:\s*([\w./-]+)@(\S+)/;

// First version-like token in a comment: v1, v1.2, v1.2.3 (with optional
// pre-release/build suffix captured loosely). Anchored on a word boundary so
// "v2.19.3" matches but a bare "2" inside other words does not.
const VERSION_TOKEN_RE = /\bv\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?\b/;

/** Parse one workflow file into its SHA-pinned `uses:` sites. */
export function parsePinSites(file: string, content: string): PinSite[] {
  const sites: PinSite[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = SHA_PIN_RE.exec(lines[i]);
    if (!m) continue;
    sites.push({
      file,
      line: i + 1,
      owner: m[1],
      repo: m[2],
      sha: m[3],
      comment: (m[4] ?? "").trim(),
    });
  }
  return sites;
}

/**
 * Find `uses:` lines that reference a floating ref (no 40-hex SHA). Reported at
 * info level — the actions-pinning policy wants SHA pins, but enforcing that is
 * a separate concern from D4-3's comment-accuracy check.
 */
export function findFloatingUses(file: string, content: string): Finding[] {
  const out: Finding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (SHA_PIN_RE.test(lines[i])) continue;
    const m = USES_RE.exec(lines[i]);
    if (!m) continue;
    // A non-SHA ref (tag or branch). Docker/local refs (`./`, `docker://`)
    // have no version comment contract — skip them.
    if (m[1].startsWith(".") || m[1].includes("docker://")) continue;
    out.push({
      level: "info",
      code: "PIN-FLOATING-REF",
      file,
      line: i + 1,
      message: `'uses: ${m[1]}@${m[2]}' is not pinned to a 40-hex commit SHA (info — pinning policy, not a D4-3 comment check)`,
    });
  }
  return out;
}

/** Extract the version token a comment claims (e.g. "v6.0.2"), or null. */
export function commentVersion(comment: string): string | null {
  const m = VERSION_TOKEN_RE.exec(comment);
  return m ? m[0] : null;
}

// ── SHA -> tag resolution ─────────────────────────────────────────

/**
 * Resolve the tag names pointing at `sha` for `owner/repo` via
 * `git ls-remote --tags`. `git ls-remote` prints two lines per annotated tag:
 * `refs/tags/X` (the tag object) and `refs/tags/X^{}` (the peeled commit).
 * A lightweight tag prints only `refs/tags/X` holding the commit directly. So
 * `sha` matches tag `X` when EITHER row's object id equals `sha`; the peeled
 * `^{}` suffix is stripped before recording the tag name.
 *
 * Returns the matched tag-name set, or null on any transport/process failure
 * (caller treats null as a warning, not a gate failure).
 */
async function resolveTagsViaGit(
  owner: string,
  repo: string,
  sha: string,
): Promise<string[] | null> {
  const url = `https://github.com/${owner}/${repo}.git`;
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "--tags", url], {
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const matched = new Set<string>();
    for (const row of stdout.split(/\r?\n/)) {
      if (!row) continue;
      const [objId, ref] = row.split(/\s+/, 2);
      if (objId !== sha || !ref?.startsWith("refs/tags/")) continue;
      const tag = ref.slice("refs/tags/".length).replace(/\^\{\}$/, "");
      matched.add(tag);
    }
    return [...matched];
  } catch (err) {
    // A `git ls-remote` transport failure (network down, repo unreachable) is
    // surfaced, not swallowed: emit a stderr breadcrumb here and return null so
    // the caller raises a PIN-RESOLVE-FAILED warning finding (network policy —
    // not a gate failure, mirroring scripts/check-cli-cves.ts queryErrors).
    console.warn(
      `validate-action-pins: ls-remote failed for ${owner}/${repo} (${(err as Error).message})`,
    );
    return null;
  }
}

// ── Core ──────────────────────────────────────────────────────────

async function listWorkflowFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    // An absent workflows dir is a benign empty result (no workflows to check):
    // emit a stderr breadcrumb and return [] so the validator reports 0 checked
    // sites in its summary line rather than crashing. Mirrors the missing-dir
    // tolerance in scripts/validate-canonical.ts.
    console.warn(`validate-action-pins: no workflows dir at ${dir} (${(err as Error).message})`);
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((f) => join(dir, f));
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const dir = opts.workflowsDir ?? WORKFLOWS_DIR;
  const resolveTags = opts.resolveTags ?? resolveTagsViaGit;
  const findings: Finding[] = [];

  const files = await listWorkflowFiles(dir);
  // Cache resolution per (owner/repo@sha) so the same action pinned in several
  // files (e.g. harden-runner across every workflow) resolves once.
  const cache = new Map<string, string[] | null>();
  let checkedSites = 0;

  for (const absFile of files) {
    const rel = absFile.slice(ROOT.length + 1);
    const content = await readFile(absFile, "utf8");

    findings.push(...findFloatingUses(rel, content));

    for (const site of parsePinSites(rel, content)) {
      checkedSites++;
      if (site.comment === "") {
        findings.push({
          level: "info",
          code: "PIN-NO-COMMENT",
          file: rel,
          line: site.line,
          message: `${site.owner}/${site.repo}@${site.sha.slice(0, 10)} has no '# <version>' comment (info — add one so the SHA stays human-readable)`,
        });
        continue;
      }
      const claimed = commentVersion(site.comment);
      if (claimed === null) {
        findings.push({
          level: "info",
          code: "PIN-COMMENT-NO-VERSION",
          file: rel,
          line: site.line,
          message: `${site.owner}/${site.repo}@${site.sha.slice(0, 10)} comment '${site.comment}' has no recognizable version token (info)`,
        });
        continue;
      }

      const key = `${site.owner}/${site.repo}@${site.sha}`;
      let tags = cache.get(key);
      if (tags === undefined) {
        tags = await resolveTags(site.owner, site.repo, site.sha);
        cache.set(key, tags);
      }

      if (tags === null) {
        findings.push({
          level: "warning",
          code: "PIN-RESOLVE-FAILED",
          file: rel,
          line: site.line,
          message: `could not resolve ${site.owner}/${site.repo}@${site.sha.slice(0, 10)} via 'git ls-remote' (network — treated as a warning, not a gate failure)`,
        });
        continue;
      }

      if (tags.length === 0) {
        // SHA resolved but no tag points at it (e.g. pinned to a non-release
        // commit). The comment cannot be verified against a tag — surface as a
        // warning rather than assert drift.
        findings.push({
          level: "warning",
          code: "PIN-SHA-UNTAGGED",
          file: rel,
          line: site.line,
          message: `${site.owner}/${site.repo}@${site.sha.slice(0, 10)} (comment '${site.comment}') resolves to no tag — cannot verify the comment against a release tag`,
        });
        continue;
      }

      if (!tags.includes(claimed)) {
        const tagList = [...tags].sort().join(", ");
        findings.push({
          level: "error",
          code: "PIN-COMMENT-DRIFT",
          file: rel,
          line: site.line,
          message: `${site.owner}/${site.repo}@${site.sha.slice(0, 10)} comment claims '${claimed}' but the SHA resolves to tag(s): ${tagList}. Rewrite the comment to the precise resolved version.`,
        });
      }
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else if (f.level === "warning") warningCount++;
    else infoCount++;
  }
  return { findings, errorCount, warningCount, infoCount, checkedSites };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : f.level === "warning" ? "WARN " : "INFO ";
  return `[${tag} ${f.code}] ${f.file}:${f.line} ${f.message}`;
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
    console.log(
      `validate-action-pins: ${result.checkedSites} SHA-pinned site(s) checked; ${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info`,
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
    console.error("validate-action-pins failed:", err);
    process.exit(1);
  });
}
