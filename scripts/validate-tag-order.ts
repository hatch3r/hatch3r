#!/usr/bin/env node
/**
 * scripts/validate-tag-order.ts — Pillar P1 (CLI UI/UX Excellence),
 * P5 (Governance Self-Quality).
 *
 * Enforces the tag-ordering contract documented in
 * `.claude/rules/content-authoring.md` item 12 ("Tag ordering — primary
 * classification first", D10-SA10.6-F10.6-8):
 *
 *   The FIRST tag in a canonical artifact's `tags:` array is its primary
 *   classification. The custom-content picker
 *   (`src/cli/shared/customContentChoices.ts::buildTagGroupedCustomContentChoices`)
 *   groups each artifact under `tags[0]`, so the first tag is load-bearing
 *   for discoverability, not cosmetic. It must NOT be a context (`ctx:*`)
 *   tag — context tags are technical-compatibility statements
 *   (greenfield/brownfield/team-only), never a classification, so leading
 *   with one buckets the artifact under a context group the user does not
 *   browse by capability (the `hatch3r-pr-resolve` mis-grouping cited in
 *   the finding).
 *
 * Facet membership is read from the single source of truth
 * `src/content/tags.ts` via `isContextTag` — no hard-coded tag list here,
 * so the gate tracks the registry automatically.
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   TAG-ORDER-CTX-FIRST         `tags[0]` is a context (`ctx:*`) tag while the
 *                               artifact also carries a non-context tag that
 *                               should lead instead.
 *   TAG-CTX-BODY-CONTRADICTION  the artifact carries a project-type context
 *                               tag (`ctx:greenfield-only` /
 *                               `ctx:brownfield-only`) while its body
 *                               advertises support for the OPPOSITE project
 *                               type (D10-SA10.7-01). The ctx facet is a hard
 *                               install-time removal filter
 *                               (`src/content/index.ts` projectType guard +
 *                               `src/content/routing.ts` drop), so a
 *                               greenfield-only tag on a body that documents
 *                               brownfield support strips the artifact from
 *                               every brownfield install its own body claims
 *                               to serve. Detection is noun-anchored — the
 *                               opposite type word followed by a support noun
 *                               ("brownfield projects", "greenfield repos",
 *                               "brownfield discovery") — so adjective or
 *                               redirect mentions ("greenfield-new contract",
 *                               "Greenfield default: Atlas") do not match.
 *
 * Floor-leading (`floor:*` first) is permitted: the content-authoring rule
 * accepts a floor primary when the artifact has no capability tag, and
 * floor tags are stable classifications, so they keep picker grouping
 * deterministic. Only context-first ordering is a hard violation.
 *
 * Scanned surface: top-level published artifacts that the custom picker
 * groups — `agents/hatch3r-*.md`, `skills/hatch3r-<name>/SKILL.md`,
 * `rules/hatch3r-*.md`, `commands/hatch3r-*.md`, `hooks/hatch3r-*.md`.
 * Support/companion subdirectories (`agents/shared`, `agents/modes`,
 * `commands/board`, `commands/rework`) are not standalone picker items
 * and are out of scope.
 *
 * Pillars: P1 (CLI UI/UX — picker discoverability), P5 (Governance
 * Self-Quality).
 *
 * Usage: `npm run validate:efficiency`
 *        `tsx scripts/validate-tag-order.ts`
 *        `tsx scripts/validate-tag-order.ts --json`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  isContextTag,
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_GREENFIELD_ONLY,
} from "../src/content/tags.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  message: string;
}

interface ParsedFile {
  relPath: string;
  tags: string[];
  fmParseFailed: boolean;
  /** Body lines (content after the frontmatter block; whole file when none). */
  bodyLines: string[];
  /** 1-indexed file line number of the first body line. */
  bodyStartLine: number;
}

export interface RunOptions {
  root?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  checkedFiles: number;
}

// ── Path helpers ──────────────────────────────────────────────────

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// ── Frontmatter parsing ───────────────────────────────────────────

function extractTags(raw: string): { tags: string[]; fmParseFailed: boolean } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { tags: [], fmParseFailed: false };
  }
  const afterOpen = raw.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return { tags: [], fmParseFailed: true };
  const closeIdx = raw.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return { tags: [], fmParseFailed: true };
  const fmRaw = raw.slice(afterOpen, closeIdx);
  try {
    const parsed = parseYaml(fmRaw) as Record<string, unknown> | null;
    const rawTags = parsed && typeof parsed === "object" ? parsed.tags : undefined;
    if (!Array.isArray(rawTags)) return { tags: [], fmParseFailed: false };
    const tags = rawTags.filter((t): t is string => typeof t === "string");
    return { tags, fmParseFailed: false };
  } catch {
    return { tags: [], fmParseFailed: true };
  }
}

// ── Discovery ─────────────────────────────────────────────────────

/** Top-level `hatch3r-*.md` files directly under a content dir (no recursion). */
async function listTopLevelArtifacts(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.startsWith("hatch3r-") && n.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => join(dir, n));
}

/** `skills/hatch3r-<name>/SKILL.md` — one SKILL.md per hatch3r-prefixed subdir. */
async function listSkillArtifacts(skillsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (!name.startsWith("hatch3r-")) continue;
    const skillPath = join(skillsDir, name, "SKILL.md");
    try {
      if ((await stat(skillPath)).isFile()) out.push(skillPath);
    } catch {
      // no SKILL.md in this subdir; skip
    }
  }
  return out;
}

async function collectArtifacts(root: string): Promise<string[]> {
  const [agents, rules, commands, hooks, skills] = await Promise.all([
    listTopLevelArtifacts(join(root, "agents")),
    listTopLevelArtifacts(join(root, "rules")),
    listTopLevelArtifacts(join(root, "commands")),
    listTopLevelArtifacts(join(root, "hooks")),
    listSkillArtifacts(join(root, "skills")),
  ]);
  return [...agents, ...rules, ...commands, ...hooks, ...skills];
}

/**
 * Split the body off the frontmatter so the contradiction check never scans
 * the `tags:` line itself (the ctx tag value contains the project-type word).
 * Unterminated frontmatter falls through to the whole file — the paired
 * `fmParseFailed` warning already skips such files before any body check.
 */
function extractBody(raw: string): { bodyLines: string[]; bodyStartLine: number } {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { bodyLines: lines, bodyStartLine: 1 };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return { bodyLines: lines.slice(i + 1), bodyStartLine: i + 2 };
    }
  }
  return { bodyLines: lines, bodyStartLine: 1 };
}

async function loadFile(absPath: string, baseDir: string): Promise<ParsedFile> {
  const raw = await readFile(absPath, "utf-8");
  const { tags, fmParseFailed } = extractTags(raw);
  const { bodyLines, bodyStartLine } = extractBody(raw);
  return { relPath: toPosixRel(absPath, baseDir), tags, fmParseFailed, bodyLines, bodyStartLine };
}

// ── Core check ────────────────────────────────────────────────────

function checkTagOrder(file: ParsedFile): Finding[] {
  const first = file.tags[0];
  if (first === undefined) return []; // no tags — handled by tag-facet-integrity gates elsewhere
  if (!isContextTag(first)) return []; // capability / floor / other primary is fine

  // tags[0] is a context tag. If a non-context tag exists later, it should lead.
  const betterPrimary = file.tags.find((t) => !isContextTag(t));
  if (betterPrimary === undefined) return []; // context-only artifact — no capability/floor to promote
  return [
    {
      level: "error",
      code: "TAG-ORDER-CTX-FIRST",
      file: file.relPath,
      message:
        `primary tag (tags[0]) is the context tag \`${first}\`; ` +
        `lead with a capability/floor tag (e.g. \`${betterPrimary}\`) so the custom picker ` +
        `groups it by classification, not by project-context (content-authoring item 12 / D10-SA10.6-F10.6-8)`,
    },
  ];
}

// ── Tag-vs-body contradiction check (D10-SA10.7-01) ───────────────

/**
 * Opposite-project-type SUPPORT language: the opposite type word immediately
 * followed by a support noun ("brownfield projects", "greenfield codebase",
 * "brownfield discovery"). Calibrated against the live corpus 2026-07-11:
 * fires on the three support claims in the pre-fix `hatch3r-roadmap.md`
 * body (lines 26/112/603) while passing the two adjective/redirect uses that
 * a bare word match would false-positive on (`rules/hatch3r-contract-census.md`
 * "greenfield-new contract", `rules/hatch3r-migrations.md` "Greenfield
 * default: Atlas").
 */
function oppositeSupportRe(oppositeWord: string): RegExp {
  return new RegExp(
    `\\b${oppositeWord}[-\\s]+(?:projects?|repos?|repositories|codebases?|installs?|modes?|discovery|support(?:ed)?)\\b`,
    "i",
  );
}

const CTX_PROJECT_TYPE_PAIRS: ReadonlyArray<{ tag: string; opposite: string }> = [
  { tag: TAG_CTX_GREENFIELD_ONLY, opposite: "brownfield" },
  { tag: TAG_CTX_BROWNFIELD_ONLY, opposite: "greenfield" },
];

function checkCtxBodyContradiction(file: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const { tag, opposite } of CTX_PROJECT_TYPE_PAIRS) {
    if (!file.tags.includes(tag)) continue;
    const re = oppositeSupportRe(opposite);
    const hitLines: number[] = [];
    for (let i = 0; i < file.bodyLines.length; i++) {
      if (re.test(file.bodyLines[i])) hitLines.push(file.bodyStartLine + i);
    }
    if (hitLines.length > 0) {
      findings.push({
        level: "error",
        code: "TAG-CTX-BODY-CONTRADICTION",
        file: file.relPath,
        message:
          `tagged \`${tag}\` but the body advertises ${opposite} support at line(s) ${hitLines.join(", ")}; ` +
          `the ctx facet is a hard install-time removal filter (src/content/tags.ts — "removed regardless of preset"), ` +
          `so this tag strips the artifact from every ${opposite} install its own body claims to serve — ` +
          `drop the tag or remove the ${opposite}-support language (D10-SA10.7-01)`,
      });
    }
  }
  return findings;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.root ?? ROOT;
  const findings: Finding[] = [];
  const candidates = await collectArtifacts(root);
  let checkedFiles = 0;

  for (const p of candidates) {
    const f = await loadFile(p, root);
    if (f.fmParseFailed) {
      findings.push({
        level: "warning",
        code: "TAG-ORDER-FM-PARSE",
        file: f.relPath,
        message: "frontmatter YAML parse failed; skipping tag-order check for this file",
      });
      continue;
    }
    checkedFiles += 1;
    findings.push(...checkTagOrder(f));
    findings.push(...checkCtxBodyContradiction(f));
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { findings, errorCount, warningCount, checkedFiles };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.file}: ${f.message}`;
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
      const line = formatFinding(f);
      // eslint-disable-next-line no-console
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-tag-order: ${result.checkedFiles} artifact(s) checked; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-tag-order failed:", err);
    process.exit(1);
  });
}
