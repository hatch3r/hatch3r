#!/usr/bin/env node
/**
 * scripts/validate-references-currency.ts — Cycle 11 D5-38
 * ("references-currency hygiene: verify-family skills carry bare-URL
 * `## References` with 0 access dates/trust tiers; cli-* skills assert
 * CVE/version-floor claims with no `## References` block — both violate
 * D5-SA5.6-L4 with no CI backstop").
 *
 * Pillars: P2 (Scientific & Practical Quality — measurable, sourced claims),
 *          P3 (Adapter & External Tool Currency — re-verifiable citations),
 *          P5 (Governance Self-Quality).
 *
 * Standard enforced (D5-SA5.6-L4, `governance/audit/domains/
 * D05-prompt-engineering.md`): any skill asserting an empirical platform claim
 * — model-tier prices, eval/CLI tool names + install commands, pinpoint WCAG
 * criteria, GitHub Projects V2 / Azure Boards API behavior, CVE/version
 * floors — carries a `## References` block whose entries each pair a URL with
 * an access date AND a trust tier, per the citation format in
 * `agents/shared/rigor-contract.md`:
 *   `[source](url) (accessed YYYY-MM-DD, <org>, <trust-tier>)`.
 *
 * WARNING-LEVEL by design (the fix column specifies "(warning)"): this gate
 * never fails CI (always exits 0). The shipped corpus still carries bare-URL
 * References blocks that are backfilled across multiple concurrent work units;
 * an error-level gate would red the green baseline before that backfill lands.
 * The warning stream is the durable backstop that surfaces every
 * access-date / trust-tier omission and every empirical-claim skill missing a
 * `## References` block, so drift is visible in CI rather than silent
 * (the D5-38 "no CI backstop" root cause). A future cycle may promote
 * REF-LINE-NO-DATE / REF-LINE-NO-TIER to error once the corpus is clean.
 *
 * SCOPE (D5-SA5.8-02): Check A (reference-line hygiene) runs across all three
 * classes that carry the content-authoring Decision-#14 `## References`
 * contract — skills, top-level `agents/*.md`, and top-level `rules/*.md`.
 * Before this widen the gate collected `skills/` only, so 28 agents + 42 rules
 * carrying the identical dated/trust-tiered contract were ungated. Check B
 * (empirical-claim marker → missing block) stays skills-only: its
 * CVE / version-floor / WCAG markers target the volatile claims that
 * concentrate in skills, so agents/rules are held to "access-date + trust-tier
 * presence" only, not the skills-specific missing-block assertion.
 *
 * Two checks, both emit `level: "warning"` findings:
 *
 *   Check A — reference-line hygiene (REF-LINE-NO-DATE / REF-LINE-NO-TIER):
 *     For every skill that HAS a `## References` block, each bullet line that
 *     carries a URL must also carry (a) an access date in `YYYY-MM-DD` form
 *     near an "accessed" marker, and (b) a recognised trust tier. A line
 *     missing either is flagged. Non-URL bullets (sub-notes, prose) are
 *     skipped.
 *
 *   Check B — missing References block (REF-BLOCK-MISSING):
 *     A skill body that carries a high-confidence empirical-claim marker — a
 *     CVE/GHSA advisory id, a version floor ("minimum recommended version",
 *     "version floor", "pin to >="), or a WCAG contrast ratio (e.g. `4.5:1`)
 *     — but has NO `## References` block is flagged. The marker set is
 *     deliberately narrow (mirroring `scripts/validate-cli-skills.ts`'s
 *     keyword-marker approach) so the gate does not false-positive on prose
 *     that merely mentions a tool name.
 *
 * Usage:
 *   tsx scripts/validate-references-currency.ts
 *   tsx scripts/validate-references-currency.ts --json
 *   npm run validate:references-currency
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// Canonical skills tree. Each `skills/<name>/SKILL.md` is one artifact.
const DEFAULT_SKILLS_DIR = "skills";

// Canonical agent + rule trees. content-authoring Decision #14 binds the same
// dated, trust-tiered `## References` contract on new agents and rules as on
// skills; D5-SA5.8-02 widened this gate from skills-only to all three classes
// so the per-cycle recency re-verification the contract mandates is mechanized
// for every shipped class, not one of three. Top-level `*.md` only —
// `agents/shared/*` + `agents/modes/*` are companion material outside the
// published-artifact count (governance/inventory.json), and `.mdc` rule twins
// carry no independent `## References` body.
const DEFAULT_AGENTS_DIR = "agents";
const DEFAULT_RULES_DIR = "rules";

/**
 * Recognised trust tiers. The first five are verbatim from
 * `agents/shared/rigor-contract.md` §3 (highest → lowest). The last two are
 * the additional slugs the content-authoring rule's Decision #14 source-trust
 * language admits ("established agent/skill libraries with named maintainers,
 * peer-reviewed methodology") and that already ship in the skills corpus
 * (`established-library`, `peer-reviewed-methodology`). A reference line must
 * name one of these (or an `tier:`-prefixed label such as
 * "tier: vendor advisory") to satisfy the trust-tier half of the citation
 * contract.
 */
const TRUST_TIERS: readonly string[] = [
  "official-docs",
  "peer-reviewed",
  "vendor-note",
  "independent-analysis",
  "blog-post",
  "established-library",
  "peer-reviewed-methodology",
];

/**
 * Accept the canonical tier slugs above PLUS the established free-form tier
 * phrasings already shipped in the corpus (e.g. cli-gh writes
 * "tier: vendor advisory — GitHub CLI maintainers" and
 * "tier: official advisory feed"). The marker is the substring "tier:" /
 * "tier =" or any canonical slug — keeping the gate from re-flagging the
 * format the corpus already standardised on.
 */
const TIER_MARKER_RE = new RegExp(
  `(?:\\btier\\s*[:=]|${TRUST_TIERS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "i",
);

/** An access date: an "accessed" marker followed (same line) by YYYY-MM-DD. */
const ACCESS_DATE_RE = /accessed[^0-9]{0,8}\d{4}-\d{2}-\d{2}/i;

/** A URL inside a reference bullet (http(s), or a bare host in backticks). */
const URL_RE = /(https?:\/\/\S+|`[a-z0-9.-]+\.[a-z]{2,}\/[^`]*`|`[a-z0-9.-]+\.[a-z]{2,}`)/i;

/**
 * A reference-list item: a Markdown bullet (`-` / `*`) OR an ordered-list item
 * (`1.`, `2.`, …). Agents ship in two citation dialects — bullet
 * (`- [Title](url) …`, the skills/rules majority) and numbered
 * (`1. [Title](url) …`, used by greenfield-spec + brownfield-spec) — so ordered
 * items must be recognised, or the numbered dialect escapes Check A entirely
 * (D5-SA5.8-02). Numbered support is additive: existing bullet dialects are
 * unaffected.
 */
const REFERENCE_ITEM_RE = /^\s*(?:[-*]|\d+\.)\s+/;

/**
 * Empirical-claim markers for Check B. A skill body containing any of these
 * but no `## References` block is asserting a re-verifiable platform claim
 * without a citation block. Kept narrow on purpose to avoid false positives.
 */
const CVE_ID_RE = /\b(?:CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/i;
const VERSION_FLOOR_RE = /(minimum recommended version|version floor|pin to >=|pin >=)/i;
const WCAG_RATIO_RE = /\b\d(?:\.\d+)?:1\b/; // e.g. 4.5:1, 3:1 contrast ratios

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  /** Repo-relative path of the offending skill file. */
  file: string;
  /** 1-based line number (0 when the finding is file-scoped, e.g. a missing block). */
  line: number;
  message: string;
}

export interface RunOptions {
  /** Override repo root; defaults to the script root. */
  rootDir?: string;
  /** Override the skills directory (relative to rootDir). */
  skillsDir?: string;
  /** Override the agents directory (relative to rootDir). */
  agentsDir?: string;
  /** Override the rules directory (relative to rootDir). */
  rulesDir?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Number of SKILL.md files inspected. */
  checkedSkills: number;
  /** Number of skills that carry a `## References` block. */
  skillsWithReferences: number;
  /** Number of top-level `agents/*.md` files inspected. */
  checkedAgents: number;
  /** Number of agents that carry a `## References` block. */
  agentsWithReferences: number;
  /** Number of top-level `rules/*.md` files inspected. */
  checkedRules: number;
  /** Number of rules that carry a `## References` block. */
  rulesWithReferences: number;
}

// ── Discovery ─────────────────────────────────────────────────────

/**
 * Repo-relative path in POSIX (`/`) form regardless of host OS. The `file`
 * field is a portable, cross-OS diagnostic id, so a Windows `\` separator must
 * never leak into it.
 */
function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

/**
 * List every `skills/<name>/SKILL.md` under the skills dir. A missing skills
 * dir yields an empty list (skipped, not a fault) so tests can point at a
 * tmpdir with no skills.
 */
async function listSkillFiles(absSkillsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(absSkillsDir);
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // A missing skills dir carries no artifacts to check — the empty return
    // is the intended signal, not a swallowed fault.
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const dir = join(absSkillsDir, name);
    let s;
    try {
      s = await stat(dir);
    } catch {
      // A directory entry that disappeared between readdir and stat is not a
      // skill to check — skipping it is the intended behavior.
      continue;
    }
    if (!s.isDirectory()) continue;
    const skillPath = join(dir, "SKILL.md");
    try {
      const fs = await stat(skillPath);
      if (fs.isFile()) out.push(skillPath);
    } catch {
      // No SKILL.md in this directory (e.g. a support subdir) — the absence
      // is the intended signal, so there is nothing to report.
      continue;
    }
  }
  return out;
}

/**
 * List every top-level `*.md` file directly under `absDir` (no recursion, no
 * `.mdc` twins). A missing dir yields an empty list (skipped, not a fault), so
 * tests can point at a tmpdir with no agents/rules. Used for the agents and
 * rules classes, whose published artifacts are flat `<class>/<name>.md` files;
 * `agents/shared` + `agents/modes` companions are excluded by the no-recursion
 * rule to match the published-artifact count in governance/inventory.json.
 */
async function listTopLevelMarkdown(absDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // A missing dir carries no artifacts to check — the empty return is the
    // intended signal, not a swallowed fault.
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (!name.endsWith(".md")) continue; // skip `.mdc` twins + non-markdown
    const abs = join(absDir, name);
    try {
      const s = await stat(abs);
      if (s.isFile()) out.push(abs);
    } catch {
      // A directory entry that disappeared between readdir and stat is not a
      // file to check — skipping it is the intended behavior.
      continue;
    }
  }
  return out;
}

// ── Reference-block extraction ─────────────────────────────────────

interface ReferenceBlock {
  /** 1-based line number of the `## References` heading. */
  headingLine: number;
  /** Bullet lines (text + 1-based line number) inside the block. */
  bullets: { text: string; line: number }[];
}

/**
 * Locate the `## References` block in a body and return its list-item lines.
 * The block runs from the heading up to the next `## ` heading (or EOF).
 * Returns `null` when there is no `## References` heading. A reference item is
 * any line whose first non-space token is a Markdown bullet (`-` / `*`) or an
 * ordered-list marker (`1.`, `2.`, …) per {@link REFERENCE_ITEM_RE}.
 */
function extractReferenceBlock(body: string): ReferenceBlock | null {
  const lines = body.split("\n");
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+References\s*$/i.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return null;
  const bullets: { text: string; line: number }[] = [];
  for (let j = headingIdx + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break; // next section boundary
    if (REFERENCE_ITEM_RE.test(lines[j])) {
      bullets.push({ text: lines[j], line: j + 1 });
    }
  }
  return { headingLine: headingIdx + 1, bullets };
}

// ── Core check ────────────────────────────────────────────────────

/**
 * Scan one artifact body for reference-currency findings.
 *
 * Check A (reference-line hygiene) runs for every class: each URL-bearing
 * reference item must carry an access date AND a trust tier.
 *
 * Check B (empirical-claim marker present but no `## References` block) runs
 * only when `checkEmpiricalMarkers` is true — it is skills-scoped by design
 * (D5-SA5.8-02): the CVE / version-floor / WCAG markers concentrate the
 * volatile pricing / tool / contrast claims in skills, and the widen holds
 * agents/rules to "access-date + trust-tier presence" only.
 *
 * Returns the findings plus whether the body carried a `## References` block.
 */
function scanFile(
  raw: string,
  rel: string,
  opts: { checkEmpiricalMarkers: boolean },
): { findings: Finding[]; hasReferences: boolean } {
  const findings: Finding[] = [];
  const block = extractReferenceBlock(raw);

  if (block) {
    // Check A — reference-line hygiene.
    for (const bullet of block.bullets) {
      if (!URL_RE.test(bullet.text)) continue; // non-URL item (prose / sub-note)
      if (!ACCESS_DATE_RE.test(bullet.text)) {
        findings.push({
          level: "warning",
          code: "REF-LINE-NO-DATE",
          file: rel,
          line: bullet.line,
          message:
            `reference line carries a URL but no \`accessed YYYY-MM-DD\` date ` +
            `(D5-SA5.6-L4 / rigor-contract citation format). ` +
            `Append e.g. " (accessed ${todayIso()}, <org>, <trust-tier>)".`,
        });
      }
      if (!TIER_MARKER_RE.test(bullet.text)) {
        findings.push({
          level: "warning",
          code: "REF-LINE-NO-TIER",
          file: rel,
          line: bullet.line,
          message:
            `reference line carries a URL but no trust tier ` +
            `(one of: ${TRUST_TIERS.join(", ")}; or a "tier:" label). ` +
            `Append e.g. " (accessed ${todayIso()}, <org>, official-docs)".`,
        });
      }
    }
    return { findings, hasReferences: true };
  }

  if (opts.checkEmpiricalMarkers) {
    // Check B — empirical-claim marker present but no References block.
    const markers: string[] = [];
    if (CVE_ID_RE.test(raw)) markers.push("CVE/GHSA advisory id");
    if (VERSION_FLOOR_RE.test(raw)) markers.push("version floor");
    if (WCAG_RATIO_RE.test(raw)) markers.push("WCAG contrast ratio");
    if (markers.length > 0) {
      findings.push({
        level: "warning",
        code: "REF-BLOCK-MISSING",
        file: rel,
        line: 0,
        message:
          `skill asserts an empirical platform claim (${markers.join(", ")}) ` +
          `but has no \`## References\` block (D5-SA5.6-L4). ` +
          `Add a \`## References\` block citing the source with URL + access date + trust tier.`,
      });
    }
  }
  return { findings, hasReferences: false };
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const absSkillsDir = join(rootDir, opts.skillsDir ?? DEFAULT_SKILLS_DIR);
  const absAgentsDir = join(rootDir, opts.agentsDir ?? DEFAULT_AGENTS_DIR);
  const absRulesDir = join(rootDir, opts.rulesDir ?? DEFAULT_RULES_DIR);

  const skillFiles = await listSkillFiles(absSkillsDir);
  const agentFiles = await listTopLevelMarkdown(absAgentsDir);
  const ruleFiles = await listTopLevelMarkdown(absRulesDir);

  const findings: Finding[] = [];

  // Scan one class of artifact files, accumulating findings and counting the
  // files that carry a `## References` block. `checkEmpiricalMarkers` gates
  // Check B (skills-only); agents/rules run Check A (line hygiene) only.
  const scanClass = async (
    files: readonly string[],
    checkEmpiricalMarkers: boolean,
  ): Promise<number> => {
    let withReferences = 0;
    for (const abs of files) {
      let raw: string;
      try {
        raw = await readFile(abs, "utf-8");
      } catch {
        continue;
      }
      const rel = abs.startsWith(rootDir) ? toPosixRel(abs, rootDir) : abs;
      const res = scanFile(raw, rel, { checkEmpiricalMarkers });
      findings.push(...res.findings);
      if (res.hasReferences) withReferences += 1;
    }
    return withReferences;
  };

  const skillsWithReferences = await scanClass(skillFiles, true);
  const agentsWithReferences = await scanClass(agentFiles, false);
  const rulesWithReferences = await scanClass(ruleFiles, false);

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }

  return {
    findings,
    errorCount,
    warningCount,
    checkedSkills: skillFiles.length,
    skillsWithReferences,
    checkedAgents: agentFiles.length,
    agentsWithReferences,
    checkedRules: ruleFiles.length,
    rulesWithReferences,
  };
}

/** Current date in YYYY-MM-DD (UTC) for the remediation hint text only. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  return `[${tag} ${f.code}] ${loc}: ${f.message}`;
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
      console.warn(formatFinding(f));
    }
    console.log(
      `validate-references-currency: ` +
        `${result.checkedSkills} skill(s) (${result.skillsWithReferences} with ## References), ` +
        `${result.checkedAgents} agent(s) (${result.agentsWithReferences} with ## References), ` +
        `${result.checkedRules} rule(s) (${result.rulesWithReferences} with ## References) checked; ` +
        `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  // Warning-level gate: never fail CI. Exit non-zero only on an actual error
  // finding, which this gate does not currently emit (reserved for a future
  // promotion once the corpus is clean).
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // process.argv[1] unresolvable (e.g. embedded host) → treat as imported,
    // not run-as-script. The false return is the intended signal.
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-references-currency failed:", err);
    process.exit(1);
  });
}
