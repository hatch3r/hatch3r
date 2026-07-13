#!/usr/bin/env node
/**
 * scripts/validate-skill-refs.ts — Cycle 12 CL-2 U9 (D5-SA5.6-10).
 *
 * Deterministic skill-lint, layer (a) of the skill/agent behavioral eval
 * harness: resolves backticked artifact ids and repo-relative file paths
 * inside skill/agent/command bodies against `governance/inventory.json` and
 * the filesystem, so ghost routes (`/h4tcher-learn`, SA5.6-03) and dead-end
 * references (the `writeHandoff(...)` class, SA5.6-02) fail a gate instead of
 * surviving structural validation.
 *
 * Scan surface: `skills/<dir>/SKILL.md` + `agents/*.md` + `commands/*.md`.
 *
 * Checks (one ERROR finding per hit, file:line diagnostics):
 *
 *   SKILL-REF-ID-UNRESOLVED   Inline-code span that is exactly an id-like
 *                             token (`^/?(hatch3r|h4tcher)-[a-z0-9-]+(\.md)?$`)
 *                             does not resolve against the union of per-class
 *                             file stems in governance/inventory.json.
 *   SKILL-REF-SUBAGENT-UNKNOWN  `subagent_type: "hatch3r-…"` (fenced or not)
 *                             names an agent id absent from files.agents.
 *   SKILL-REF-PATH-MISSING    Inline-code span that is exactly a repo-relative
 *                             path (first segment in CHECKED_ROOTS) does not
 *                             exist on disk (after stripping `:NN`/`:NN-MM`
 *                             line anchors and `#fragment`s).
 *   SKILL-REF-TS-CALL         A line pairs a call-notation span `fn(...)`
 *                             with a `src/**.ts` path span — instructing an
 *                             LLM persona to call a CLI-internal TypeScript
 *                             function it cannot invoke (bin-only package).
 *
 * Precision guards: fenced code blocks are skipped for ID/PATH/TS-CALL checks
 * (they hold templates and output examples); spans containing whitespace or
 * placeholder characters (`<>{}$*|"'`) are skipped; `.claude/**` and
 * `.hatch3r/**` paths are never checked (in shipped bodies they denote
 * END-USER repo paths, so repo-existence is the wrong predicate — the
 * framework-leak class stays owned by the D5-9 deny-scan recommendation).
 *
 * Allowlist: `scripts/skill-eval-allowlist.json`, section `refs`. Entries
 * match on (file, token, code). Two sanctioned reason classes:
 * `pre-existing (cycle-12 CL-2 U9 census)` for danglers found at first run,
 * and `forward-reference: <finding-id>` for intentional references to
 * artifacts queued for authoring. Full mechanism + census:
 * `.audit-workspace/content-specs/skill-eval-harness.spec.md`.
 *
 * Pillars: P2 (Scientific Quality — a gate now executes the reference
 * surface), P5 (Governance Self-Quality), P4 (Lean Coverage — inventory.json
 * stays the single source of truth for artifact ids).
 *
 * Usage:
 *   tsx scripts/validate-skill-refs.ts
 *   tsx scripts/validate-skill-refs.ts --json
 *   tsx scripts/validate-skill-refs.ts --root <dir>   (test fixture seam)
 *
 * Exits 0 when no error findings remain after allowlist filtering, 1 otherwise.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Types ─────────────────────────────────────────────────────────

export interface Finding {
  level: "error";
  code:
    | "SKILL-REF-ID-UNRESOLVED"
    | "SKILL-REF-SUBAGENT-UNKNOWN"
    | "SKILL-REF-PATH-MISSING"
    | "SKILL-REF-TS-CALL";
  /** Repo-relative path of the scanned file. */
  file: string;
  /** 1-based line number of the hit. */
  line: number;
  /** The normalized token/path that failed resolution. */
  token: string;
  message: string;
}

export interface AllowlistEntry {
  file: string;
  token: string;
  code: string;
  reason: string;
  added: string;
}

export interface RunResult {
  filesScanned: number;
  /** Findings that survived allowlist filtering (these gate the exit code). */
  findings: Finding[];
  /** Findings suppressed by the allowlist — kept visible for census reporting. */
  allowlisted: Finding[];
  errorCount: number;
}

export interface RunOptions {
  /** Repo root override (test fixture seam). Defaults to this repo's root. */
  rootDir?: string;
}

// ── Constants ─────────────────────────────────────────────────────

/**
 * Repo-relative path spans are only checked when their first segment is one
 * of these canonical-content roots. Calibration (2026-07-12, this corpus)
 * showed that generic roots (`src/`, `docs/`, `scripts/`, `website/`) are
 * ambiguous in SHIPPED bodies — they usually denote paths in the END-USER's
 * repo (`docs/specs` output conventions, `src/auth/oauth` scaffold targets),
 * so repo-existence is the wrong predicate there. Artifact-class roots +
 * `governance/` are unambiguous self-references (and `governance/*` cites in
 * shipped bodies are banned outright by the D5-9 citation-path policy, so a
 * miss there is always a real dangler).
 */
export const CHECKED_ROOTS = new Set([
  "agents",
  "skills",
  "rules",
  "commands",
  "hooks",
  "checks",
  "github-agents",
  "governance",
]);

/** Exactly an id-like token: optional slash-command `/`, optional `.md` basename suffix. */
const ID_SPAN_RE = /^\/?(?:hatch3r|h4tcher)-[a-z0-9][a-z0-9-]*(?:\.md)?$/;

/** Exactly a repo-relative path: >=1 slash, plain path characters only. */
const PATH_SPAN_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@-]+)+\/?$/;

/** Call notation: `identifier(...)` with any argument text. */
const CALL_SPAN_RE = /^[A-Za-z_$][\w$]*\([^)]*\)$/;

/** A src/ TypeScript module path (the non-invocable entry-point class). */
const SRC_TS_PATH_RE = /^src\/[\w./@-]+\.ts$/;

/** Spans containing whitespace or placeholder characters are templates, not refs. */
const PLACEHOLDER_RE = /[\s<>{}$*|"']/;

const SUBAGENT_RE = /subagent_type:\s*"([^"]+)"/g;

// ── Inventory / allowlist loading ─────────────────────────────────

interface Inventory {
  files?: Record<string, string[]>;
}

/**
 * Reduce every inventory file entry to its id stem: the basename minus
 * extension, plus (for `skills/<id>/SKILL.md`-shaped entries) the directory
 * component. Generous by design — only tokens matching ID_SPAN_RE are ever
 * checked, so extra known ids only reduce false positives.
 */
export function buildKnownIds(inventory: Inventory): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(inventory.files ?? {})) {
    for (const entry of list) {
      const segments = entry.split("/");
      // Directory components (e.g. `hatch3r-a11y-audit` from `hatch3r-a11y-audit/SKILL.md`).
      for (const seg of segments.slice(0, -1)) ids.add(seg);
      const basename = segments[segments.length - 1];
      ids.add(basename.replace(/\.[a-z]+$/, ""));
    }
  }
  return ids;
}

/** Agent ids only — the resolution set for `subagent_type` values. */
export function buildAgentIds(inventory: Inventory): Set<string> {
  const ids = new Set<string>();
  for (const entry of inventory.files?.agents ?? []) {
    ids.add(entry.replace(/\.md$/, ""));
  }
  return ids;
}

async function loadInventory(rootDir: string): Promise<Inventory> {
  const raw = await readFile(join(rootDir, "governance", "inventory.json"), "utf-8");
  return JSON.parse(raw) as Inventory;
}

/**
 * Load the `refs` section of scripts/skill-eval-allowlist.json under rootDir.
 * A missing allowlist file is an empty allowlist (fixture roots need none).
 */
export async function loadAllowlist(rootDir: string, section: "refs" | "contracts"): Promise<AllowlistEntry[]> {
  const path = join(rootDir, "scripts", "skill-eval-allowlist.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const entries = parsed[section];
  return Array.isArray(entries) ? (entries as AllowlistEntry[]) : [];
}

export function isAllowlisted(allowlist: readonly AllowlistEntry[], f: Finding): boolean {
  return allowlist.some((a) => a.file === f.file && a.token === f.token && a.code === f.code);
}

// ── Scanning ──────────────────────────────────────────────────────

/** Extract inline-code span contents from a single (non-fence-delimiter) line. */
export function inlineCodeSpans(line: string): string[] {
  const spans: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) spans.push(m[1]);
  return spans;
}

/** Strip `:NN`, `:NN-MM` line anchors and `#fragment` suffixes off a path span. */
export function normalizePathSpan(span: string): string {
  return span.replace(/#[^/]*$/, "").replace(/:\d+(?:-\d+)?$/, "");
}

/** Normalize an id-like span: strip slash-command `/` and `.md` basename suffix. */
export function normalizeIdSpan(span: string): string {
  return span.replace(/^\//, "").replace(/\.md$/, "");
}

async function pathExists(rootDir: string, rel: string): Promise<boolean> {
  try {
    await stat(join(rootDir, rel));
    return true;
    // Existence probe: a stat failure IS the negative answer this function
    // exists to produce — the caller reports it as SKILL-REF-PATH-MISSING,
    // so no separate diagnostic channel applies here.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
}

interface ScanContext {
  rootDir: string;
  knownIds: Set<string>;
  agentIds: Set<string>;
  findings: Finding[];
}

/** Scan one file's content, appending findings to ctx.findings. */
export async function scanFile(ctx: ScanContext, relFile: string, content: string): Promise<void> {
  const lines = content.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // subagent_type resolution applies everywhere, fenced blocks included —
    // delegation templates in fences are exactly what runtime agents copy.
    let sm: RegExpExecArray | null;
    SUBAGENT_RE.lastIndex = 0;
    while ((sm = SUBAGENT_RE.exec(line)) !== null) {
      const value = sm[1];
      if (/^(?:hatch3r|h4tcher)-/.test(value) && !ctx.agentIds.has(value)) {
        ctx.findings.push({
          level: "error",
          code: "SKILL-REF-SUBAGENT-UNKNOWN",
          file: relFile,
          line: lineNo,
          token: value,
          message: `subagent_type "${value}" names no agent in governance/inventory.json (files.agents)`,
        });
      }
    }

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const spans = inlineCodeSpans(line);
    let sawCallSpan: string | undefined;
    let sawSrcTsSpan = false;

    for (const rawSpan of spans) {
      const span = rawSpan.trim();

      if (CALL_SPAN_RE.test(span)) sawCallSpan = span;
      if (SRC_TS_PATH_RE.test(normalizePathSpan(span))) sawSrcTsSpan = true;

      if (PLACEHOLDER_RE.test(span)) continue;

      // Check 1 — id resolution.
      if (ID_SPAN_RE.test(span)) {
        const id = normalizeIdSpan(span);
        if (!ctx.knownIds.has(id)) {
          ctx.findings.push({
            level: "error",
            code: "SKILL-REF-ID-UNRESOLVED",
            file: relFile,
            line: lineNo,
            token: span,
            message: `id "${span}" resolves to no artifact in governance/inventory.json (any class)`,
          });
        }
        continue;
      }

      // Check 3 — path resolution.
      if (PATH_SPAN_RE.test(span)) {
        const rel = normalizePathSpan(span).replace(/\/$/, "");
        const firstSegment = rel.split("/")[0];
        if (!CHECKED_ROOTS.has(firstSegment)) continue;
        if (!(await pathExists(ctx.rootDir, rel))) {
          ctx.findings.push({
            level: "error",
            code: "SKILL-REF-PATH-MISSING",
            file: relFile,
            line: lineNo,
            token: span,
            message: `path "${rel}" does not exist in the repository`,
          });
        }
      }
    }

    // Check 4 — TS-call dead end (the writeHandoff class, SA5.6-02).
    if (sawCallSpan !== undefined && sawSrcTsSpan) {
      ctx.findings.push({
        level: "error",
        code: "SKILL-REF-TS-CALL",
        file: relFile,
        line: lineNo,
        token: sawCallSpan,
        message:
          `call-notation "${sawCallSpan}" is paired with a src/**.ts path on the same line — ` +
          `an LLM persona cannot invoke CLI-internal TypeScript functions (bin-only package; ` +
          `mirror the hatch3r-learn shell-entry fix instead)`,
      });
    }
  }
}

/** Enumerate the scan surface: skills/<dir>/SKILL.md + agents/*.md + commands/*.md. */
export async function listScanFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  const skillsDir = join(rootDir, "skills");
  try {
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = join("skills", entry.name, "SKILL.md");
      try {
        await stat(join(rootDir, rel));
        files.push(rel);
        // A skill dir without SKILL.md is skipped by design —
        // src/cli/commands/validate.ts owns that warning surface, so
        // re-emitting here would double-report the same defect.
        // eslint-disable-next-line silent-failure/no-silent-catch
      } catch {
        // Intentionally empty: see comment above.
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  for (const dir of ["agents", "commands"]) {
    try {
      for (const entry of await readdir(join(rootDir, dir), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(dir, entry.name));
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

// ── Runner ────────────────────────────────────────────────────────

export async function runValidator(options: RunOptions = {}): Promise<RunResult> {
  const rootDir = options.rootDir ?? ROOT;
  const inventory = await loadInventory(rootDir);
  const allowlist = await loadAllowlist(rootDir, "refs");

  const ctx: ScanContext = {
    rootDir,
    knownIds: buildKnownIds(inventory),
    agentIds: buildAgentIds(inventory),
    findings: [],
  };

  const scanFiles = await listScanFiles(rootDir);
  for (const rel of scanFiles) {
    const content = await readFile(join(rootDir, rel), "utf-8");
    // Findings carry POSIX-style relative paths regardless of platform.
    await scanFile(ctx, rel.split("\\").join("/"), content);
  }

  const findings: Finding[] = [];
  const allowlisted: Finding[] = [];
  for (const f of ctx.findings) {
    if (isAllowlisted(allowlist, f)) allowlisted.push(f);
    else findings.push(f);
  }

  return {
    filesScanned: scanFiles.length,
    findings,
    allowlisted,
    errorCount: findings.length,
  };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  return `[ERROR ${f.code}] ${f.file}:${f.line}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json") };
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1] !== undefined) {
    flags.root = resolve(argv[i + 1]);
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator(flags.root ? { rootDir: flags.root } : {});
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) console.error(formatFinding(f));
    console.log(
      `validate-skill-refs: ${result.filesScanned} file(s) scanned; ` +
        `${result.errorCount} error(s), ${result.allowlisted.length} allowlisted (census-visible)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // The is-main detector defaults to "not main" if either argument
    // resolution throws. The fallback path is the test-import path; no
    // diagnostic channel applies because tests intentionally import this module.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-skill-refs failed:", err);
    process.exit(1);
  });
}
