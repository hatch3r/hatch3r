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
 * Failure mode (emits one ERROR finding):
 *
 *   TAG-ORDER-CTX-FIRST   `tags[0]` is a context (`ctx:*`) tag while the
 *                         artifact also carries a non-context tag that
 *                         should lead instead.
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
 * `commands/board`, `commands/revision`) are not standalone picker items
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
import { isContextTag } from "../src/content/tags.js";

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

async function loadFile(absPath: string, baseDir: string): Promise<ParsedFile> {
  const raw = await readFile(absPath, "utf-8");
  const { tags, fmParseFailed } = extractTags(raw);
  return { relPath: toPosixRel(absPath, baseDir), tags, fmParseFailed };
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
