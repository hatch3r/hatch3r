#!/usr/bin/env node
/**
 * scripts/validate-verify-gate-literals.ts — Cycle 11 D16-4
 * ("generated pipeline self-contradicts on toolchain": the loop's
 * implementer/fixer/reviewer use the language-aware `${HATCH3R:VERIFY_GATE_ALL}`
 * token, but skills/commands hard-code `npm run lint && npm run typecheck &&
 * npm run test` as the operative Verify gate — on a Python/Rust project the
 * agent runs a command that does not exist, sees no output, and continues).
 *
 * Pillars: P5 (Governance Self-Quality), P2 (Scientific Quality),
 *          P3 (Adapter & External Tool Currency).
 *          Content-quality axis: CQ5 (Reliability), CQ9 (Enhancability).
 *
 * The fix for the self-contradiction was to sweep every *operative* Verify
 * gate to the `${HATCH3R:VERIFY_GATE_*}` token, which the adapter pipeline
 * (`substituteVerifyGateTokens` in `src/adapters/base.ts`) rewrites to the
 * project's native command set at sync time. This gate makes the regression
 * a build failure: a canonical content file may not present a bare,
 * language-agnostic verification gate (`npm run test|lint|typecheck`,
 * `npm test`, `npx tsc`) as a runnable command block without the token —
 * otherwise the generated agent silently runs a non-existent command on any
 * non-npm project.
 *
 * Violation signature (one ERROR finding per offending fenced block):
 *
 *   VERIFY-GATE-LITERAL-NPM   a fenced `bash`/`sh`/`shell`/`console` block in
 *                             a canonical content file contains a line whose
 *                             command is a bare language-agnostic gate
 *                             (`npm run test`, `npm run lint`,
 *                             `npm run typecheck`, `npm test`, `npx tsc`) AND
 *                             the block carries no `${HATCH3R:VERIFY_GATE`
 *                             token — replace the gate line with
 *                             `${HATCH3R:VERIFY_GATE_ALL}` (or the matching
 *                             per-step token) so the gate resolves to the
 *                             project's native toolchain.
 *
 * Scope decisions (deliberate non-matches):
 *   - npm-ecosystem publish/release tooling that has no language-agnostic
 *     token equivalent (`npm run validate`, `npm run build`, `npm audit`,
 *     `npm install`, `npm ci`, `lockfile-lint`) is NOT flagged — only the
 *     lint/typecheck/test gate triple is.
 *   - A block that already carries a `${HATCH3R:VERIFY_GATE...}` token is
 *     treated as adopted: the literal lines beside it are documented as the
 *     resolver's fallback, not a competing operative gate.
 *   - Inline-code spans (single backticks) and prose mentions are NOT
 *     flagged — only runnable fenced command blocks, which is what an agent
 *     copies and executes.
 *
 * The validator emits a one-line summary plus per-finding diagnostics on
 * stderr, mirroring `scripts/validate-repo-token-adoption.ts`. CI wires it
 * via `npm run validate:efficiency`.
 *
 * Usage:
 *   tsx scripts/validate-verify-gate-literals.ts
 *   tsx scripts/validate-verify-gate-literals.ts --json
 *   npm run validate:efficiency
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// Canonical content directories that ship to end-user repos. `src/` and
// `scripts/` are excluded: this framework IS an npm/TS project, so its own
// build tooling under `src/` legitimately runs `npm run test`. A missing
// dir (e.g. `prompts/`) is skipped silently.
const DEFAULT_SCAN_DIRS: readonly string[] = [
  "agents",
  "skills",
  "rules",
  "commands",
  "hooks",
  "checks",
  "prompts",
  "github-agents",
];

const CONTENT_EXTENSIONS: readonly string[] = [".md", ".mdc"];

// Fenced-block languages whose contents an agent copies and runs verbatim.
const RUNNABLE_FENCE_LANGS: readonly string[] = ["bash", "sh", "shell", "console"];

// The token family that proves a block resolves to the project's toolchain.
const VERIFY_GATE_TOKEN_PREFIX = "${HATCH3R:VERIFY_GATE";

// A line whose command is a bare language-agnostic verification gate. Anchored
// at line start (after optional leading whitespace / `$ ` prompt) so a comment
// or a longer command containing the substring elsewhere does not match.
// `pnpm run test` / `yarn test` do NOT match `npm run test` here because the
// regex requires the command token to start at a word boundary.
const BARE_GATE_LINE =
  /^\s*\$?\s*(npm run (?:test|lint|typecheck)|npm test|npx tsc)\b/;

/**
 * Repo-relative path in POSIX (`/`) form regardless of host OS. The `file`
 * field is a portable, cross-OS diagnostic id, so a Windows `\` separator from
 * `relative()` must never leak into it.
 */
function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  /** Repo-relative path of the offending file. */
  file: string;
  /** 1-based line of the opening fence of the offending block. */
  line: number;
  /** The bare gate command that triggered the finding. */
  command: string;
  message: string;
}

export interface RunOptions {
  /** Override repo root; defaults to the script root. */
  rootDir?: string;
  /** Override the scanned content directories (relative to rootDir). */
  scanDirs?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Number of content files scanned across all scan dirs. */
  scannedFiles: number;
}

// ── Discovery ─────────────────────────────────────────────────────

async function walkContentFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return out;
  }
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const abs = join(absDir, name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...(await walkContentFiles(abs)));
      continue;
    }
    if (!s.isFile()) continue;
    if (!CONTENT_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    out.push(abs);
  }
  return out;
}

// ── Core check ────────────────────────────────────────────────────

/**
 * Scan one file body for offending fenced blocks. Returns one finding per
 * block (not per line) so a block with several bare gate lines surfaces a
 * single actionable diagnostic. The first matching command is quoted.
 */
export function findBareGateBlocks(body: string, fileLabel: string): Finding[] {
  const findings: Finding[] = [];
  const lines = body.split("\n");

  let inBlock = false;
  let blockLang = "";
  let blockOpenLine = 0;
  let blockBody: string[] = [];

  const flush = () => {
    if (!RUNNABLE_FENCE_LANGS.includes(blockLang)) return;
    const joined = blockBody.join("\n");
    if (joined.includes(VERIFY_GATE_TOKEN_PREFIX)) return; // adopted
    const offending = blockBody.find((l) => BARE_GATE_LINE.test(l));
    if (!offending) return;
    const match = offending.match(BARE_GATE_LINE);
    findings.push({
      level: "error",
      code: "VERIFY-GATE-LITERAL-NPM",
      file: fileLabel,
      line: blockOpenLine,
      command: (match?.[1] ?? offending).trim(),
      message:
        `runnable \`${blockLang}\` block presents the bare gate \`${(match?.[1] ?? offending).trim()}\` ` +
        `with no \`${VERIFY_GATE_TOKEN_PREFIX}...}\` token. On a non-npm project the generated agent ` +
        `runs a command that does not exist and continues silently (CQ5 reliability / D16-4). ` +
        `Replace the gate line with \`\${HATCH3R:VERIFY_GATE_ALL}\` (resolved to the project's ` +
        `native lint+typecheck+test command at sync time); keep any npm-ecosystem publish tooling ` +
        `(\`npm run build\`, \`npm audit\`, \`lockfile-lint\`) on separate lines.`,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^```+\s*([\w-]+)?\s*$/);
    if (fence) {
      if (!inBlock) {
        inBlock = true;
        blockLang = (fence[1] ?? "").toLowerCase();
        blockOpenLine = i + 1;
        blockBody = [];
      } else {
        flush();
        inBlock = false;
        blockLang = "";
        blockBody = [];
      }
      continue;
    }
    if (inBlock) blockBody.push(lines[i]);
  }

  return findings;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const scanDirs = opts.scanDirs ?? DEFAULT_SCAN_DIRS;

  const files: string[] = [];
  for (const dirRel of scanDirs) {
    files.push(...(await walkContentFiles(join(rootDir, dirRel))));
  }

  const findings: Finding[] = [];
  for (const abs of files) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    findings.push(...findBareGateBlocks(raw, toPosixRel(abs, rootDir)));
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }

  return { findings, errorCount, warningCount, scannedFiles: files.length };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.file}:${f.line}: ${f.message}`;
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
      `validate-verify-gate-literals: ${result.scannedFiles} content file(s) scanned; ` +
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
    console.error("validate-verify-gate-literals failed:", err);
    process.exit(1);
  });
}
