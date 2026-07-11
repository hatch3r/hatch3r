#!/usr/bin/env node
/**
 * scripts/validate-adapter-output.ts — Pillar P3 (Adapter & External Tool
 * Currency), P2 (Scientific Quality — data-flow verification), P5 (Governance
 * Self-Quality).
 *
 * Audit Cycle 11 D11-2 (High). `scripts/validate-rule-parity.ts` opens only the
 * `rules/*.md` + `.mdc` pair and never invokes `getAdapter`/`generate`, so the
 * RUNTIME glob transform — the globs/applyTo/paths each adapter actually emits
 * to `.cursor/rules/`, `.github/instructions/`, and `.claude/rules/` — is
 * unverified by CI. That blind spot is why the Cycle-11 GLOBS-DROP Critical
 * (D6-1 / D9-1 / D11-1: every `scope: conditional` rule emitted the literal
 * token `"conditional"` as its glob, or dropped `paths:` entirely) shipped green
 * — the `.md`/`.mdc` parity gate is satisfied by content the adapters never read.
 *
 * This gate closes the loop on the OTHER side of the transform: it generates
 * each of the 3 supported adapters (cursor, copilot, claude) over the FULL
 * canonical rule corpus and asserts, per canonical rule, that the glob set the
 * adapter emitted equals the set derived from the rule's own `.md` frontmatter
 * via {@link resolveRuleGlobs} (which mirrors `validate-rule-parity.ts`'s
 * `csvToSet`). A `scope: conditional` rule whose `.md` declares
 * `globs: "src/lib/*.ts,*.md"` MUST surface exactly that pattern set in:
 *   - cursor:  `globs: ["src/lib/*.ts", "*.md"]`   (.cursor/rules/NN-<id>.mdc)
 *   - copilot: `applyTo: "src/lib/*.ts, *.md"`     (.github/instructions/NN-<id>.instructions.md)
 *   - claude:  `paths:` block sequence, one `  - "<glob>"` line per pattern
 *              (.claude/rules/NN-<id>.md). D9-SA9.1-02 (Cycle 12) switched this
 *              channel from the flow array `paths: ["src/lib/*.ts", "*.md"]` to
 *              the block form the Claude Code memory docs document verbatim
 *              (code.claude.com/docs/en/memory); the parser accepts both shapes.
 * An unconditional rule (`scope: always`, or conditional with no patterns) MUST
 * emit no glob shape — and on copilot it MUST be inlined into
 * `.github/copilot-instructions.md` (no per-file instruction output), because a
 * scoped instruction file with an empty `applyTo` would never match any file.
 *
 * Reuses the production emission helpers (`getAdapter().generate()`,
 * `resolveRuleGlobs`, `csvToGlobList`, `toPrefixedId`) rather than
 * re-implementing the transform, so the gate cannot drift away from the code it
 * guards. Exits 0 on full parity, 1 on any per-rule glob mismatch with a
 * per-finding diff (adapter, rule id, expected set, emitted set).
 *
 * Usage: `npm run validate:adapter-parity`
 *        `tsx scripts/validate-adapter-output.ts`
 *        `tsx scripts/validate-adapter-output.ts --json`
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAdapter } from "../src/adapters/index.js";
import {
  readCanonicalFiles,
  resolveRuleGlobs,
} from "../src/adapters/canonical.js";
import { resolveBundledContentRoot } from "../src/content/contentRoot.js";
import { createManifest } from "../src/manifest/hatchJson.js";
import { toPrefixedId, type AdapterOutput, type CanonicalFile, type Tool } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  tool: Tool;
  ruleId: string;
  message: string;
}

export interface RunOptions {
  /** Bundled content root; defaults to `resolveBundledContentRoot()`. */
  root?: string;
  /** Override the adapter set (test injection). */
  tools?: readonly Tool[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  checkedRules: number;
  checkedTools: number;
}

// The 3 supported adapters (CONSTITUTION §6 Decision 12). Each emits glob
// frontmatter on its rule channel under a different key/path.
export const ADAPTER_TOOLS: readonly Tool[] = ["claude", "copilot", "cursor"];

// Per-adapter rule-channel descriptor: the output directory prefix every
// per-rule emission lives under, and the extractor that pulls the emitted glob
// set out of that output's frontmatter. Returning `null` means "this output is
// not a per-file scoped rule emission" (e.g. a `globs`-less cursor rule that
// fell back to `alwaysApply`) — the emitted set for that rule is then empty.
export interface RuleChannel {
  /** Path prefix that every per-rule output for this adapter starts with. */
  dirPrefix: string;
  /** Filename suffix that every per-rule output ends with. */
  fileSuffix: string;
  /** Extract the emitted glob set from one output's frontmatter, or null. */
  extract(content: string): Set<string> | null;
}

export const RULE_CHANNELS: Record<Tool, RuleChannel> = {
  cursor: {
    dirPrefix: ".cursor/rules/",
    fileSuffix: ".mdc",
    extract: (content) => extractBracketArray(content, "globs"),
  },
  copilot: {
    dirPrefix: ".github/instructions/",
    fileSuffix: ".instructions.md",
    extract: (content) => extractCsvString(content, "applyTo"),
  },
  claude: {
    dirPrefix: ".claude/rules/",
    fileSuffix: ".md",
    extract: (content) => extractPathsSequence(content),
  },
};

// ── Frontmatter glob extractors ───────────────────────────────────

/**
 * Pull a single frontmatter scalar line (`key: <value>`) from the leading
 * `---`-fenced block, or null when the key is absent / there is no frontmatter.
 * Frontmatter on every adapter rule output is single-line-per-field, so a
 * line-anchored scan is sufficient and avoids a YAML dependency.
 */
function frontmatterLine(content: string, key: string): string | null {
  const fence = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return null;
  const block = fence[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (m && m[1] === key) return (m[2] ?? "").trim();
  }
  return null;
}

/**
 * Extract a JSON-flow array of quoted strings (`globs: ["a", "b"]` /
 * `paths: ["a", "b"]`) into a Set. Returns null when the key is absent (the
 * rule emitted no array shape — unconditional). Mirrors the de-dup semantics of
 * `validate-rule-parity.ts`'s `csvToSet` by collapsing the parsed members into
 * a Set.
 */
function extractBracketArray(content: string, key: string): Set<string> | null {
  const value = frontmatterLine(content, key);
  if (value === null) return null;
  // value looks like `["src/**/*.ts", "*.md"]` (or `[]`).
  const inner = value.replace(/^\[/, "").replace(/\]$/, "");
  const set = new Set<string>();
  for (const part of inner.split(",")) {
    const g = part.trim().replace(/^["']|["']$/g, "");
    if (g) set.add(g);
  }
  return set;
}

/**
 * Extract a comma-separated quoted glob string (`applyTo: "a, b"`) into a Set.
 * Returns null when the key is absent. VS Code's `applyTo` is a single
 * comma-separated string, so this splits on commas after stripping the
 * surrounding quotes.
 */
function extractCsvString(content: string, key: string): Set<string> | null {
  const value = frontmatterLine(content, key);
  if (value === null) return null;
  const unquoted = value.replace(/^["']/, "").replace(/["']$/, "");
  const set = new Set<string>();
  for (const part of unquoted.split(",")) {
    const g = part.trim();
    if (g) set.add(g);
  }
  return set;
}

/**
 * Extract the claude channel's `paths:` glob set, accepting BOTH the current
 * documented block-sequence form and the legacy flow-array form. Returns null
 * when the `paths:` key is absent (the rule emitted no path shape —
 * unconditional). Unlike {@link extractBracketArray}, this reads the multi-line
 * YAML block sequence the claude adapter now emits, so a single-line frontmatter
 * scan is insufficient.
 *
 * D9-SA9.1-02 (Cycle 12, D9, P3) switched
 * `src/adapters/claude.ts::claudeRulePathsFrontmatter` from the flow array
 * (`paths: ["a", "b"]`) to the block sequence the Claude Code memory docs
 * document verbatim (code.claude.com/docs/en/memory, accessed 2026-07-11) —
 * `paths:` on its own line, then one `  - "<glob>"` item line per pattern. This
 * parser reads both shapes so the gate never false-fails on either:
 *
 *   block-sequence (current emission):    flow-array (accepted legacy):
 *     paths:                                paths: ["src/lib/*.ts", "*.md"]
 *       - "src/lib/*.ts"
 *       - "*.md"
 *
 * De-dup semantics match the other extractors — parsed members collapse into a
 * Set, mirroring `validate-rule-parity.ts`'s `csvToSet`.
 */
function extractPathsSequence(content: string): Set<string> | null {
  const fence = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return null;
  const lines = (fence[1] ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = (lines[i] ?? "").match(/^paths:\s*(.*)$/);
    if (!head) continue;
    const inline = (head[1] ?? "").trim();
    const set = new Set<string>();
    if (inline.startsWith("[")) {
      // Legacy flow-array form: `paths: ["a", "b"]` (or `paths: []`).
      const inner = inline.replace(/^\[/, "").replace(/\]$/, "");
      for (const part of inner.split(",")) {
        const g = part.trim().replace(/^["']|["']$/g, "");
        if (g) set.add(g);
      }
    } else {
      // Block-sequence form: consume `  - "<glob>"` item lines until the first
      // non-item line (the closing `---` was already stripped by the fence).
      for (let j = i + 1; j < lines.length; j++) {
        const item = (lines[j] ?? "").match(/^\s+-\s+(.*)$/);
        if (!item) break;
        const g = (item[1] ?? "").trim().replace(/^["']|["']$/g, "");
        if (g) set.add(g);
      }
    }
    return set;
  }
  return null;
}

// ── Output indexing ───────────────────────────────────────────────

/**
 * Map a canonical rule id to its per-rule output for one adapter, returning the
 * extracted emitted glob set. Returns an empty Set when no per-rule output
 * matched (the rule was emitted unconditionally — cursor `alwaysApply`, claude
 * no-`paths:`, or copilot inlined into copilot-instructions.md).
 *
 * Matching is exact on the prefixed id, derived by stripping the channel's
 * `dirPrefix`, the leading `NN-` precedence prefix, and the `fileSuffix` from
 * each candidate path. Substring matching is deliberately avoided: real
 * canonical ids nest (`hatch3r-security` ⊂ `hatch3r-security-patterns`,
 * `hatch3r-agent-orchestration` ⊂ `hatch3r-agent-orchestration-detail`), so a
 * `path.includes(prefixedId)` test would alias the shorter id onto the longer
 * id's file.
 */
export function emittedGlobsFor(
  outputs: AdapterOutput[],
  channel: RuleChannel,
  prefixedId: string,
): Set<string> {
  for (const out of outputs) {
    if (!out.path.startsWith(channel.dirPrefix)) continue;
    if (!out.path.endsWith(channel.fileSuffix)) continue;
    const basename = out.path.slice(channel.dirPrefix.length, out.path.length - channel.fileSuffix.length);
    // Strip the `NN-` numeric precedence prefix (10-/30-/50-/70-).
    const idPart = basename.replace(/^\d+-/, "");
    if (idPart !== prefixedId) continue;
    const set = channel.extract(out.content);
    return set ?? new Set<string>();
  }
  return new Set<string>();
}

// ── Set comparison ────────────────────────────────────────────────

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function sortedList(s: Set<string>): string {
  return JSON.stringify([...s].sort());
}

// ── Core ──────────────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.root ?? resolveBundledContentRoot();
  const tools = opts.tools ?? ADAPTER_TOOLS;
  const findings: Finding[] = [];

  // Single canonical read; the expected glob set per rule is derived from the
  // rule's own `.md` frontmatter via the SAME resolver the adapters use.
  const rules: CanonicalFile[] = await readCanonicalFiles(root, "rules");

  for (const tool of tools) {
    const manifest = createManifest({ tools: [tool], mcpServers: [] });
    const outputs = await getAdapter(tool).generate(root, manifest);
    const channel = RULE_CHANNELS[tool];

    for (const rule of rules) {
      const expected = new Set(resolveRuleGlobs(rule));
      const prefixedId = toPrefixedId(rule.id);
      const emitted = emittedGlobsFor(outputs, channel, prefixedId);

      if (!setsEqual(expected, emitted)) {
        findings.push({
          level: "error",
          code: "P3-ADAPTER-GLOB-DRIFT",
          tool,
          ruleId: rule.id,
          message:
            `emitted glob set != .md-derived set. ` +
            `expected ${sortedList(expected)}, emitted ${sortedList(emitted)} ` +
            `(channel ${channel.dirPrefix})`,
        });
      }
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else warningCount++;
  }
  return {
    findings,
    errorCount,
    warningCount,
    checkedRules: rules.length,
    checkedTools: tools.length,
  };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.tool}/${f.ruleId}: ${f.message}`;
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
      else console.warn(line);
    }
    console.log(
      `validate-adapter-output: ${result.checkedRules} rule(s) × ${result.checkedTools} adapter(s) checked; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // A path-resolve failure here means "not the entry module"; treat as
    // not-main and fall through to the import path (benign probe, no diagnostic).
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-adapter-output failed:", err);
    process.exit(1);
  });
}
