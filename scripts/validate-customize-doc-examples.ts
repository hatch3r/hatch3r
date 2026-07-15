#!/usr/bin/env node
/**
 * scripts/validate-customize-doc-examples.ts — Cycle 11 D10-10
 * ("Documented `.customize.yaml` examples emit validator warnings on
 * copy-paste").
 *
 * Pillars: P1 (CLI UI/UX Excellence — first-run / copy-paste success),
 *          P5 (Governance Self-Quality),
 *          P4 (Lean Coverage — docs stay truthful to the schema).
 *
 * The `.customize.yaml` override file is keyed by its filename
 * (`.hatch3r/{type}/{id}.customize.yaml`), and the runtime validator
 * (`src/cli/commands/validate.ts::validateCustomizeYaml` and
 * `src/models/customize.ts`) accepts ONLY the four fields
 * {model, scope, description, enabled} — mirroring the
 * `src/models/customize.ts::Customization` interface. A documented example
 * that opens with a redundant leading key (`agent:`/`skill:`/`rule:`/
 * `command:`) produces an "unknown field" warning the moment a user pastes
 * it, plus an ambiguous partial-apply. This gate parses every fenced `yaml`
 * block that a documentation file introduces as a `.customize.yaml` example
 * and asserts each top-level key is in the allowlist, so the docs cannot
 * drift back out of sync with the schema.
 *
 * Block selection (the "under customize headings" scope from the finding's
 * fix column): a fenced ```yaml block is treated as a `.customize.yaml`
 * example only when the nearest preceding non-blank prose line mentions
 * `.customize.yaml`. That lead-in is how all four guide sections introduce
 * their examples ("Create `.hatch3r/agents/{agent-id}.customize.yaml`:",
 * "In `.hatch3r/agents/hatch3r-reviewer.customize.yaml`:"). Frontmatter or
 * non-customize yaml blocks (e.g. a `type: hook` hook-definition example)
 * carry no such lead-in and are out of scope, avoiding false positives.
 *
 * Failure mode (one ERROR finding per offending key):
 *
 *   CUSTOMIZE-DOC-UNKNOWN-FIELD   a `.customize.yaml` doc example declares a
 *                                 top-level key outside
 *                                 {model, scope, description, enabled}.
 *
 * Scanned surface: every `*.md` under `docs/` and `website/docs/` that
 * references `.customize.yaml` — the maintainer-authored documentation
 * corpus where these examples live.
 *
 * Usage: `npm run validate:efficiency`
 *        `tsx scripts/validate-customize-doc-examples.ts`
 *        `tsx scripts/validate-customize-doc-examples.ts --json`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/**
 * The only keys a `.customize.yaml` override may declare. Authoritative
 * runtime source: `src/cli/commands/validate.ts::validateCustomizeYaml`
 * (`VALID_FIELDS`) and the `src/models/customize.ts::Customization`
 * interface. Kept in lock-step with those — a key added there must be added
 * here, which a `.customize.yaml` doc example would then legitimately use.
 */
const VALID_CUSTOMIZE_FIELDS = new Set([
  "model",
  "effort",
  "scope",
  "description",
  "enabled",
]);

/** Directories whose `*.md` documentation files are scanned. */
const DOC_DIRS = ["docs", join("website", "docs")];

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  line: number;
  message: string;
}

export interface RunOptions {
  root?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  checkedFiles: number;
  checkedBlocks: number;
}

// ── Path helpers ──────────────────────────────────────────────────

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

/** Recursively collect every `*.md` file under `dir`. */
async function listMarkdown(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const full = join(dir, name);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...(await listMarkdown(full)));
    } else if (s.isFile() && name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// ── Block extraction ──────────────────────────────────────────────

interface YamlBlock {
  /** 1-based line number of the opening fence. */
  fenceLine: number;
  /** Block body (between the fences), newline-joined. */
  body: string;
  /** Nearest preceding non-blank prose line (the lead-in), lower-cased. */
  leadIn: string;
}

const FENCE_OPEN = /^```ya?ml\s*$/;
const FENCE_ANY = /^```/;

/** Extract every fenced yaml block plus the prose line that introduces it. */
function extractYamlBlocks(raw: string): YamlBlock[] {
  const lines = raw.split(/\r?\n/);
  const blocks: YamlBlock[] = [];
  let lastProse = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_OPEN.test(line)) {
      const fenceLine = i + 1;
      const bodyLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (FENCE_ANY.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      blocks.push({
        fenceLine,
        body: bodyLines.join("\n"),
        leadIn: lastProse.toLowerCase(),
      });
      i = j; // resume after the closing fence
      continue;
    }
    if (line.trim() !== "" && !FENCE_ANY.test(line)) {
      lastProse = line.trim();
    }
  }
  return blocks;
}

/** True when a block's lead-in introduces it as a `.customize.yaml` example. */
function isCustomizeExample(block: YamlBlock): boolean {
  return block.leadIn.includes(".customize.yaml");
}

// ── Core check ────────────────────────────────────────────────────

function checkBlock(block: YamlBlock, relPath: string): Finding[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(block.body);
  } catch {
    // A doc example that does not parse as YAML is its own (separate)
    // problem; this gate only enforces the field allowlist on valid YAML.
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (!VALID_CUSTOMIZE_FIELDS.has(key)) {
      findings.push({
        level: "error",
        code: "CUSTOMIZE-DOC-UNKNOWN-FIELD",
        file: relPath,
        line: block.fenceLine,
        message:
          `.customize.yaml example declares unknown top-level field \`${key}\` ` +
          `(valid: ${[...VALID_CUSTOMIZE_FIELDS].join(", ")}). ` +
          `The file is keyed by its filename, so drop the redundant leading key — ` +
          `a pasted example otherwise trips an "unknown field" validator warning (D10-10).`,
      });
    }
  }
  return findings;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.root ?? ROOT;
  const findings: Finding[] = [];
  let checkedFiles = 0;
  let checkedBlocks = 0;

  const fileLists = await Promise.all(
    DOC_DIRS.map((d) => listMarkdown(join(root, d))),
  );
  const files = fileLists.flat();

  for (const abs of files) {
    const raw = await readFile(abs, "utf-8");
    if (!raw.includes(".customize.yaml")) continue;
    checkedFiles += 1;
    const relPath = toPosixRel(abs, root);
    for (const block of extractYamlBlocks(raw)) {
      if (!isCustomizeExample(block)) continue;
      checkedBlocks += 1;
      findings.push(...checkBlock(block, relPath));
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { findings, errorCount, warningCount, checkedFiles, checkedBlocks };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.file}:${f.line}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
  /** Scan root override (defaults to the repo root); used by the gate test. */
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json") };
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1 && argv[rootIdx + 1] !== undefined) {
    flags.root = resolve(argv[rootIdx + 1]);
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator({ root: flags.root });
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
      `validate-customize-doc-examples: ${result.checkedFiles} file(s), ` +
        `${result.checkedBlocks} customize example(s) checked; ` +
        `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-customize-doc-examples failed:", err);
    process.exit(1);
  });
}
