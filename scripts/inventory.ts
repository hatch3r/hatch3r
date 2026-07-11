#!/usr/bin/env node
/**
 * scripts/inventory.ts — Cycle 7 H10
 *
 * Derives accurate counts for hatch3r artifacts from the filesystem and writes
 * `governance/inventory.json`. The CI workflow runs `npm run inventory` then
 * `git diff --exit-code governance/inventory.json` so drift between the
 * filesystem and the committed inventory becomes a build failure.
 *
 * Pillars: P4 (Lean Coverage), P5 (Governance Self-Quality).
 *
 * Usage: `npm run inventory` (invokes via tsx). No build step required.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVAILABLE_CLI_TOOLS,
  type CliToolMeta,
} from "../src/cliTools/registry.js";
import { VALID_HOOK_EVENTS } from "../src/hooks/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/**
 * Adapter utility files that live alongside platform adapters but do not
 * implement the BaseAdapter contract. Excluded from the adapter count so the
 * inventory matches the canonical 3 platform adapters (claude/cursor/copilot).
 */
const ADAPTER_UTILITIES = new Set<string>([
  "base.ts",
  "canonical.ts",
  "customization.ts",
  "customizationSummary.ts", // customization-precedence summary helper, not a platform adapter
  "index.ts",
  "capabilityMatrix.ts",
  "mcp-utils.ts",
  "contextBudget.ts",
  "agentsmd.ts", // shared AGENTS.md helper, not a platform adapter
]);

interface InventoryCounts {
  adapters: number;
  agents: number;
  skills: number;
  /**
   * Subset of `skills` whose id starts with `hatch3r-cli-` (CLI-tooling
   * pivot, plan §5). Added in 1.7.5 alongside the cliTools manifest field;
   * `cliSkills <= skills` always.
   */
  cliSkills: number;
  rules: number;
  rulesMdc: number;
  commands: number;
  hooks: number;
  pipeline: number;
  cliCommands: number;
  /**
   * Companion-content directories (F16.3-L2 / F16.3-M3, Cycle 10). These ship
   * with the framework as reference material outside the top-level
   * agent/skill/rule/command/hook counts (per CLAUDE.md), but were previously
   * untracked — a rename/add/delete inside any of them escaped the CI drift
   * gate. Counting them here closes the capability-lifecycle drift gap while
   * preserving their "reference material, not standalone published artifact"
   * classification.
   */
  agentsModes: number;
  agentsShared: number;
  commandsBoard: number;
  commandsRevision: number;
  checks: number;
  githubAgents: number;
  /**
   * Every `*.{test,spec}.{js,ts}(x)` file under `src/` and `scripts/` — the
   * exact set `vitest.config.ts` `DEFAULT_TEST_GLOB` runs (both roots, 204 at
   * authoring time: 186 in `src/__tests__/` + 18 in `scripts/__tests__/`).
   * Added in Cycle 11 (D3-5): `governance/audit/domains/D03-test-infrastructure.md`
   * previously cited a non-existent `inventory.json.testFiles` array and a stale
   * hand-maintained count; this collector makes the array real and gates its
   * count under the CI inventory drift check so the D03 figure self-maintains.
   */
  testFiles: number;
  /**
   * CLI-tool registry catalog size, derived from `src/cliTools/registry.ts`
   * `AVAILABLE_CLI_TOOLS` — the SSoT the picker / detect / install / skill-gen
   * paths already read (and its contract test asserts 34 = 11/13/10). `cliTools`
   * is the total; the three tier keys partition it by `CliToolMeta.tier`.
   *
   * D10-SA10.1-01 (Cycle 12): the doc surfaces (README, website
   * supported-tools / cli-tools) hand-maintained a "29 / 10-11-8" enumeration
   * that drifted 5 tools behind the registry (34 / 11-13-10) across 3 releases
   * because no gate bound the docs to the registry. Counting the catalog here
   * lets `--check-docs` probe the doc count literals against the registry so
   * the enumeration self-maintains. Counts-only (no `InventoryFiles` list): the
   * tools live in the registry module, not as per-file content artifacts.
   */
  cliTools: number;
  cliToolsTier1: number;
  cliToolsTier2: number;
  cliToolsTier3: number;
}

interface InventoryFiles {
  adapters: string[];
  agents: string[];
  skills: string[];
  /** File list backing `counts.cliSkills`. */
  cliSkills: string[];
  rules: string[];
  rulesMdc: string[];
  commands: string[];
  hooks: string[];
  pipeline: string[];
  cliCommands: string[];
  /** File lists backing the companion-content counts (F16.3-L2 / F16.3-M3). */
  agentsModes: string[];
  agentsShared: string[];
  commandsBoard: string[];
  commandsRevision: string[];
  checks: string[];
  githubAgents: string[];
  /** File list backing `counts.testFiles` (repo-relative, sorted). */
  testFiles: string[];
}

export interface InventoryDocument {
  lastUpdated: string;
  counts: InventoryCounts;
  files: InventoryFiles;
}

async function listEntries(absDir: string): Promise<string[]> {
  try {
    const entries = await readdir(absDir);
    return entries.sort((a, b) => a.localeCompare(b));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function listAdapters(): Promise<string[]> {
  const dir = join(ROOT, "src", "adapters");
  const entries = await listEntries(dir);
  return entries.filter(
    (name) => name.endsWith(".ts") && !ADAPTER_UTILITIES.has(name),
  );
}

async function listTopLevelMd(
  relDir: string,
  prefix: string,
): Promise<string[]> {
  const dir = join(ROOT, relDir);
  const entries = await listEntries(dir);
  const results: string[] = [];
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith(".md")) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isFile()) results.push(name);
  }
  return results;
}

async function listMdcFiles(relDir: string, prefix: string): Promise<string[]> {
  const dir = join(ROOT, relDir);
  const entries = await listEntries(dir);
  const results: string[] = [];
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith(".mdc")) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isFile()) results.push(name);
  }
  return results;
}

/**
 * Read the `type:` field from a markdown file's YAML frontmatter, or `null`
 * when the file has no frontmatter block or no `type:` line. Minimal by design:
 * the inventory script imports only `node:` builtins (no adapter module graph),
 * so this reuses the same field-extraction semantics as
 * `src/adapters/canonical.ts::parseFrontmatter` without the dependency weight.
 * Scans only the leading `---` … `---` block so a `type:` mention in prose
 * never registers.
 */
async function readFrontmatterType(absPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf-8");
  } catch (err) {
    // Unreadable companion file: treat as type-less so the caller decides via
    // the README-by-name fallback. The inventory must not crash on one bad
    // companion file, but the read fault is surfaced on the warning channel
    // (CONSTITUTION §2 P5 Silent Failure Contract) rather than swallowed.
    console.warn(
      `inventory: could not read companion frontmatter from ${absPath} ` +
        `(${(err as Error).message}); treating as type-less.`,
    );
    return null;
  }
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const typeLine = fm[1].match(/^type:\s*(\S+)\s*$/m);
  return typeLine ? typeLine[1] : null;
}

/**
 * List every published `*.md` file directly inside a companion-content
 * directory (F16.3-L2 / F16.3-M3). Companion files carry no `hatch3r-` prefix
 * requirement (they are reference material under named support subdirectories
 * per `.claude/rules/content-authoring.md`).
 *
 * D5-50 (Cycle 11 Wave 3): a self-excluded authoring guide such as
 * `checks/README.md` (frontmatter `type: documentation`) is NOT a published
 * artifact and is NOT emitted by any adapter — `BaseAdapter.processCompanionSubdir`
 * (`src/adapters/base.ts`) skips `type: documentation` and any `README.md` by
 * name (D2-8). The inventory previously counted every `.md` here, so `checks`
 * read 6 against a real `type: check` count of 5, drifting CLAUDE.md and the D05
 * domain header. Mirror the adapter exclusion exactly (documentation type OR
 * `README.md` by name) so `inventory.json` counts the same set the adapters
 * ship. Returns `[]` for a missing directory so the inventory stays stable if a
 * directory is removed.
 */
async function listCompanionMd(relDir: string): Promise<string[]> {
  const dir = join(ROOT, relDir);
  const entries = await listEntries(dir);
  const results: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (!s.isFile()) continue;
    if (name.toLowerCase() === "readme.md") continue;
    const fmType = await readFrontmatterType(full);
    if (fmType === "documentation") continue;
    results.push(name);
  }
  return results;
}

async function listSkills(): Promise<string[]> {
  const dir = join(ROOT, "skills");
  const entries = await listEntries(dir);
  const results: string[] = [];
  for (const name of entries) {
    if (!name.startsWith("hatch3r-")) continue;
    const skillDir = join(dir, name);
    const skillFile = join(skillDir, "SKILL.md");
    try {
      const dirStat = await stat(skillDir);
      if (!dirStat.isDirectory()) continue;
      const fileStat = await stat(skillFile);
      if (fileStat.isFile()) results.push(`${name}/SKILL.md`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return results;
}

/**
 * Subset of `listSkills()` filtered to CLI-tool skills (the `hatch3r-cli-`
 * prefix introduced in plan §5). Caller passes the full skill list so this
 * remains a pure filter — no extra filesystem reads.
 */
function listCliSkills(allSkills: readonly string[]): string[] {
  return allSkills.filter((name) => name.startsWith("hatch3r-cli-"));
}

async function listSrcDirTs(relDir: string): Promise<string[]> {
  const dir = join(ROOT, relDir);
  const entries = await listEntries(dir);
  return entries.filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
}

/**
 * Roots scanned for test files, in stable order. Mirrors the two roots listed
 * in `vitest.config.ts` `DEFAULT_TEST_GLOB` (`src/**` + `scripts/**`) so the
 * inventory's `testFiles` set is exactly what `npm test` runs (D3-5).
 */
const TEST_FILE_ROOTS = ["src", "scripts"] as const;

/**
 * Matches a vitest test/spec filename: a `.test`/`.spec` segment followed by an
 * optional `c`/`m` module marker, then a `j`/`t`-script extension with optional
 * `x`. Equivalent to the `*.{test,spec}.?(c|m)[jt]s?(x)` glob in
 * `vitest.config.ts`, so the collector never drifts from the runner's include
 * set. The whole corpus is `.test.ts` today; the broader pattern future-proofs
 * against a `.spec`/`.tsx`/`.mts` test being added without a collector edit.
 */
const TEST_FILE_RE = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/;

/**
 * Directory names skipped during the recursive test-file walk. `node_modules`
 * and `dist` can appear nested under a scanned root and never hold first-party
 * tests; excluding them keeps the walk fast and the set free of vendored or
 * built artifacts (matches vitest's default excludes).
 */
const TEST_WALK_SKIP_DIRS = new Set<string>(["node_modules", "dist"]);

/**
 * Recursively list every vitest test file under the given root, repo-relative
 * and sorted. Returns `[]` for a missing root (ENOENT) so a partial checkout
 * degrades to a no-op rather than throwing. Skips `node_modules`/`dist`.
 */
async function listTestFilesUnder(relDir: string): Promise<string[]> {
  const absDir = join(ROOT, relDir);
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const name of entries) {
    if (TEST_WALK_SKIP_DIRS.has(name)) continue;
    const relPath = join(relDir, name);
    const s = await stat(join(ROOT, relPath));
    if (s.isDirectory()) {
      out.push(...(await listTestFilesUnder(relPath)));
    } else if (TEST_FILE_RE.test(name)) {
      out.push(relPath);
    }
  }
  return out;
}

/**
 * Collect every vitest test file across all `TEST_FILE_ROOTS`, repo-relative
 * with forward slashes, globally sorted for a deterministic inventory. Paths
 * are normalized to `/` so the committed `inventory.json` is byte-identical on
 * Windows checkouts (`path.join` yields `\` there) — matching the LF/`/`
 * convention the rest of the inventory and the `.gitattributes` enforce.
 */
async function listTestFiles(): Promise<string[]> {
  const collected = await Promise.all(
    TEST_FILE_ROOTS.map((root) => listTestFilesUnder(root)),
  );
  return collected
    .flat()
    .map((p) => p.split(sep).join("/"))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Build the inventory document from the filesystem.
 *
 * `today` is injected (date-only `YYYY-MM-DD`, UTC) rather than read inline so
 * the function is deterministic and testable (`.claude/rules/test-requirements.md`).
 * `main()` passes `new Date().toISOString().slice(0, 10)`; the returned
 * `lastUpdated` is provisional — `reconcileLastUpdated` may rewind it to the
 * committed value when the substantive content is unchanged.
 */
export async function buildInventory(today: string): Promise<InventoryDocument> {
  const [
    adapters,
    agents,
    skills,
    rules,
    rulesMdc,
    commands,
    hooks,
    pipeline,
    cliCommands,
    agentsModes,
    agentsShared,
    commandsBoard,
    commandsRevision,
    checks,
    githubAgents,
    testFiles,
  ] = await Promise.all([
    listAdapters(),
    listTopLevelMd("agents", "hatch3r-"),
    listSkills(),
    listTopLevelMd("rules", "hatch3r-"),
    listMdcFiles("rules", "hatch3r-"),
    listTopLevelMd("commands", "hatch3r-"),
    listTopLevelMd("hooks", "hatch3r-"),
    listSrcDirTs("src/pipeline"),
    listSrcDirTs("src/cli/commands"),
    listCompanionMd("agents/modes"),
    listCompanionMd("agents/shared"),
    listCompanionMd("commands/board"),
    listCompanionMd("commands/revision"),
    listCompanionMd("checks"),
    listCompanionMd("github-agents"),
    listTestFiles(),
  ]);

  const cliSkills = listCliSkills(skills);

  // CLI-tool catalog counts, derived from the registry the picker/detect/
  // install paths read (D10-SA10.1-01). Tiers partition the catalog via
  // `CliToolMeta.tier`, matching the registry contract test's own derivation
  // (`Object.values(AVAILABLE_CLI_TOOLS).filter(t => t.tier === N)`) — this
  // dedups tools listed under multiple tier-2 triggers (e.g. `taplo`), so a
  // trigger-array sum would over-count.
  const cliToolEntries = Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[];
  const cliToolsTier1 = cliToolEntries.filter((t) => t.tier === 1).length;
  const cliToolsTier2 = cliToolEntries.filter((t) => t.tier === 2).length;
  const cliToolsTier3 = cliToolEntries.filter((t) => t.tier === 3).length;

  return {
    lastUpdated: today,
    counts: {
      adapters: adapters.length,
      agents: agents.length,
      skills: skills.length,
      cliSkills: cliSkills.length,
      rules: rules.length,
      rulesMdc: rulesMdc.length,
      commands: commands.length,
      hooks: hooks.length,
      pipeline: pipeline.length,
      cliCommands: cliCommands.length,
      agentsModes: agentsModes.length,
      agentsShared: agentsShared.length,
      commandsBoard: commandsBoard.length,
      commandsRevision: commandsRevision.length,
      checks: checks.length,
      githubAgents: githubAgents.length,
      testFiles: testFiles.length,
      cliTools: cliToolEntries.length,
      cliToolsTier1,
      cliToolsTier2,
      cliToolsTier3,
    },
    files: {
      adapters,
      agents,
      skills,
      cliSkills,
      rules,
      rulesMdc,
      commands,
      hooks,
      pipeline,
      cliCommands,
      agentsModes,
      agentsShared,
      commandsBoard,
      commandsRevision,
      checks,
      githubAgents,
      testFiles,
    },
  };
}

/**
 * Read and parse the committed `governance/inventory.json`, if present.
 *
 * Returns `null` on ENOENT (no committed file yet) or on malformed JSON — in
 * both cases the caller falls back to stamping today's date. Any other read
 * error (permissions, I/O) is rethrown so a genuine fault is not masked.
 */
export async function readExistingInventory(
  outPath: string,
): Promise<InventoryDocument | null> {
  let raw: string;
  try {
    raw = await readFile(outPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as InventoryDocument;
  } catch (err) {
    // Malformed committed file — surface a diagnostic (CONSTITUTION.md §2 P5
    // Silent Failure Contract) then treat as absent so the regen self-heals by
    // stamping today's date and rewriting valid JSON.
    console.warn(
      `inventory: committed ${outPath} is not valid JSON ` +
        `(${(err as Error).message}); regenerating with today's date.`,
    );
    return null;
  }
}

/**
 * Structural equality of two inventory documents IGNORING `lastUpdated`.
 *
 * Compares `counts` + `files` (every counter and file list). `buildInventory`
 * emits keys in a fixed insertion order and the committed file is produced the
 * same way, so a stable `JSON.stringify` of `{ counts, files }` is an exact
 * content comparison. A committed file with reordered or extra keys (e.g. a
 * hand-edit) deserializes back through `JSON.parse`, so a non-matching shape
 * compares unequal and correctly triggers a today-stamp + rewrite.
 */
export function sameInventoryContent(
  a: InventoryDocument,
  b: InventoryDocument,
): boolean {
  const strip = (doc: InventoryDocument): string =>
    JSON.stringify({ counts: doc.counts, files: doc.files });
  return strip(a) === strip(b);
}

/**
 * Preserve-unless-changed reconciliation of `lastUpdated`.
 *
 * `fresh` carries today's date (from `buildInventory(today)`). When a committed
 * `existing` document is present AND its substantive content (counts + files)
 * matches `fresh`, the committed `lastUpdated` is reused so a no-op regen is a
 * byte-for-byte no-op (the CI drift gate at `.github/workflows/ci.yml` passes
 * every day, not just on the day content last changed). When content differs —
 * or there is no committed file — `fresh` (today) is kept, so `lastUpdated`
 * advances only on real content drift. Pillars: P5 (the gate stops flapping),
 * P4 (the field stops lying "updated today" when nothing changed).
 */
export function reconcileLastUpdated(
  fresh: InventoryDocument,
  existing: InventoryDocument | null,
): InventoryDocument {
  if (existing && sameInventoryContent(fresh, existing)) {
    return { ...fresh, lastUpdated: existing.lastUpdated };
  }
  return fresh;
}

/**
 * Count-drift probes for consumer documents (C8-D19-M1, C8-D10-M1).
 *
 * Each probe describes a filesystem document, a regex that extracts a numeric
 * count next to a descriptor (e.g. "27 rules"), and the inventory counter the
 * number must equal. Runs on `--check-docs` so CI can detect stale counts in
 * README / CLAUDE.md / plugin.json without coupling the inventory write step
 * to a blocking scan.
 */
interface DriftProbe {
  file: string;
  label: string;
  expected: keyof InventoryCounts;
  regex: RegExp;
}

const DRIFT_PROBES: DriftProbe[] = [
  // README "What You Get" table rows
  {
    file: "README.md",
    label: "Agents table row",
    expected: "agents",
    regex: /\|\s*\*\*Agents\*\*\s*\|\s*(\d+)\s*\|/,
  },
  {
    file: "README.md",
    label: "Skills table row",
    expected: "skills",
    regex: /\|\s*\*\*Skills\*\*\s*\|\s*(\d+)\s*\|/,
  },
  {
    file: "README.md",
    label: "Rules table row",
    expected: "rules",
    regex: /\|\s*\*\*Rules\*\*\s*\|\s*(\d+)\s*\|/,
  },
  {
    file: "README.md",
    label: "Commands table row",
    expected: "commands",
    regex: /\|\s*\*\*Commands\*\*\s*\|\s*(\d+)\s*\|/,
  },
  // D1-SA1.4-03 (Cycle 12 Wave 3, D1, P4): README's "Supported Tools (N
  // Adapters)" header is the one adapters count literal that only validate.ts's
  // (CLI-unreachable) validateDocsCounts probed — inventory --check-docs had no
  // README adapters probe. Add it so --check-docs strictly subsumes
  // validateDocsCounts and that dead docs branch can be deleted without losing
  // README adapters-count coverage.
  {
    file: "README.md",
    label: "README Supported-Tools adapters count",
    expected: "adapters",
    regex: /Supported Tools\s*\((\d+)\s+Adapters\)/,
  },
  // CLAUDE.md architecture table
  {
    file: "CLAUDE.md",
    label: "src/pipeline row",
    expected: "pipeline",
    regex: /\|\s*`src\/pipeline\/`\s*\|\s*(\d+)\s+pipeline modules/,
  },
  {
    file: "CLAUDE.md",
    label: "src/cli/commands row",
    expected: "cliCommands",
    regex: /\|\s*`src\/cli\/commands\/`\s*\|\s*(\d+)\s+CLI commands/,
  },
  {
    file: "CLAUDE.md",
    label: "src/adapters row",
    expected: "adapters",
    regex: /\|\s*`src\/adapters\/`\s*\|\s*(\d+)\s+platform adapters/,
  },
  // plugin.json description line
  {
    file: ".cursor-plugin/plugin.json",
    label: "plugin.json agents count",
    expected: "agents",
    regex: /(\d+)\s+agents/,
  },
  {
    file: ".cursor-plugin/plugin.json",
    label: "plugin.json skills count",
    expected: "skills",
    regex: /(\d+)\s+skills/,
  },
  {
    file: ".cursor-plugin/plugin.json",
    label: "plugin.json rules count",
    expected: "rules",
    regex: /(\d+)\s+rules/,
  },
  {
    file: ".cursor-plugin/plugin.json",
    label: "plugin.json commands count",
    expected: "commands",
    regex: /(\d+)\s+commands/,
  },
  // Cycle 10 H F16.1-H2 (D16, Track B): the plugin.json description embeds the
  // full count set ("30 agents, 43 skills, 55 rules, 23 commands, 6 hooks") but
  // the hooks figure had no drift guard — a stale "6 hooks" would ship to the
  // Cursor marketplace undetected. This probe closes that gap against the real
  // embedded literal. (CONTRIBUTING.md / SECURITY.md carry no inventory-count
  // literals, so they are out of the count-probe model; their currency is held
  // by the anti-slop + version-drift gates instead.)
  {
    file: ".cursor-plugin/plugin.json",
    label: "plugin.json hooks count",
    expected: "hooks",
    regex: /(\d+)\s+hooks/,
  },
  // Cycle 11 D3-5: D03's scope line cited a hand-maintained "All NNN test files"
  // figure that drifted (133 claimed vs 204 actual) and pointed at a then-absent
  // `inventory.json.testFiles` array. With the array now collected from the
  // filesystem (every vitest test under src/ + scripts/), this probe gates the
  // D03 figure against `counts.testFiles` so the scope line self-maintains under
  // the CI inventory drift check rather than re-staleing on the next test added.
  {
    file: "governance/audit/domains/D03-test-infrastructure.md",
    label: "D03 scope test-file count",
    expected: "testFiles",
    regex: /All\s+(\d+)\s+test files/,
  },
  // Cycle 11 D5-45: the user-question-protocol SSoT opened with a stale "15
  // supported AI coding platforms" figure (1.9.0 hard-cut the adapter set to 3).
  // The line 13 prose is static — it sits before the HATCH3R:PLATFORM-TOOL marker
  // (line 42) and is not touched by canonical-write substitution — so the count
  // can be probe-guarded at source against `counts.adapters`. This stops the
  // platform-count drift from silently re-staleing the protocol's scope sentence.
  {
    file: "agents/shared/user-question-protocol.md",
    label: "user-question-protocol supported-tools count",
    expected: "adapters",
    regex: /(\d+)\s+supported AI coding tools/,
  },
  // Cycle 11 D5-50: the D05 audit-domain file hard-coded a per-class artifact
  // census ("42 .md + 42 .mdc", "38 commands", "63 skills", "6 checks + 6 hooks
  // + 3 prompts") that drifted against live inventory (66/66, 30, 53, 5/7/0).
  // `--check-docs` previously probed README/CLAUDE.md/plugin.json but NOT the
  // domain files, so D05's census re-staled every time the corpus grew. These
  // probes extend the gate to the D05 SA-table so its counts self-maintain.
  // Each targets a count that maps to a single inventory counter; the aggregate
  // "content artifacts" total is rephrased to cite inventory.json (no single
  // counter backs a cross-class sum) rather than freeze a re-staling number.
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.4 rules (.md) count",
    expected: "rules",
    regex: /Rules\s*\((\d+)\s*\.md/,
  },
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.4 rules (.mdc) count",
    expected: "rulesMdc",
    regex: /Rules\s*\(\d+\s*\.md\s*\+\s*(\d+)\s*\.mdc\)/,
  },
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.5 commands count",
    expected: "commands",
    regex: /Commands\s*\((\d+)\)/,
  },
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.6 skills count",
    expected: "skills",
    regex: /Skills\s*\((\d+)\)/,
  },
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.7 checks count",
    expected: "checks",
    regex: /\((\d+)\s+checks\s*\+/,
  },
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.7 hooks count",
    expected: "hooks",
    regex: /\+\s*(\d+)\s+hooks\s*\+/,
  },
  {
    file: "governance/audit/domains/D05-prompt-engineering.md",
    label: "D05 SA5.7 github-agents count",
    expected: "githubAgents",
    regex: /\+\s*(\d+)\s+github-agents\)/,
  },
  // D10-SA10.1-01 (Cycle 12): bind the website CLI-tool doc counts to the
  // registry (`counts.cliTools*`). The docs hand-maintained "29 / 10-11-8"
  // while the registry grew to "34 / 11-13-10" (curl, httpie, xh, dasel,
  // container-use), and no probe caught it. These 8 probes gate the two
  // getting-started pages' total + per-tier headers. NOTE: README.md and the
  // `src/cliTools/registry.ts` / `registry.test.ts` in-code comments also carry
  // the stale counts, but those files are owned by a concurrent Wave-2 unit
  // (file-lock); their probes + content fix land with that unit's change, not
  // here — probing an uncorrected README would fail this gate closed.
  {
    file: "website/docs/getting-started/supported-tools.md",
    label: "supported-tools CLI surface total",
    expected: "cliTools",
    regex: /(\d+)-tool CLI surface area/,
  },
  {
    file: "website/docs/getting-started/supported-tools.md",
    label: "supported-tools Tier-1 count",
    expected: "cliToolsTier1",
    regex: /Tier-1 \(default-on, (\d+) tools\)/,
  },
  {
    file: "website/docs/getting-started/supported-tools.md",
    label: "supported-tools Tier-2 count",
    expected: "cliToolsTier2",
    regex: /Tier-2 \(conditional, (\d+) tools\)/,
  },
  {
    file: "website/docs/getting-started/supported-tools.md",
    label: "supported-tools Tier-3 count",
    expected: "cliToolsTier3",
    regex: /Tier-3 \(opt-in advanced, (\d+) tools\)/,
  },
  {
    file: "website/docs/getting-started/cli-tools.md",
    label: "cli-tools catalog total",
    expected: "cliTools",
    regex: /The (\d+)-tool catalog/,
  },
  {
    file: "website/docs/getting-started/cli-tools.md",
    label: "cli-tools Tier 1 count",
    expected: "cliToolsTier1",
    regex: /Tier 1 — default-on \((\d+) tools\)/,
  },
  {
    file: "website/docs/getting-started/cli-tools.md",
    label: "cli-tools Tier 2 count",
    expected: "cliToolsTier2",
    regex: /Tier 2 — conditional \((\d+) tools\)/,
  },
  {
    file: "website/docs/getting-started/cli-tools.md",
    label: "cli-tools Tier 3 count",
    expected: "cliToolsTier3",
    regex: /Tier 3 — opt-in advanced \((\d+) tools\)/,
  },
];

interface DriftResult {
  file: string;
  label: string;
  expected: number;
  found: number | null;
}

/**
 * Stale-token probes (Cycle 11 D10-9, P3 docs currency).
 *
 * Unlike count probes (which assert a number matches), these assert that a
 * decommissioned identifier never reappears in consumer docs. Each probe names
 * a removed token plus the canonical replacement to surface in the failure
 * message. D10-9 retired the four `*-customize` editor commands in v1.9.0 in
 * favour of the single `/hatch3r-customize` skill; this guard fails CI if any
 * of the four strings drift back into the website docs.
 */
interface StaleTokenProbe {
  files: string[];
  token: string;
  replacement: string;
}

const STALE_TOKEN_PROBES: StaleTokenProbe[] = [
  {
    files: [
      "website/docs/guides/customization.md",
      "website/docs/reference/skills.md",
      "website/docs/reference/commands/agent-commands.md",
    ],
    token: "agent-customize",
    replacement: "the /hatch3r-customize skill",
  },
  {
    files: [
      "website/docs/guides/customization.md",
      "website/docs/reference/skills.md",
      "website/docs/reference/commands/agent-commands.md",
    ],
    token: "command-customize",
    replacement: "the /hatch3r-customize skill",
  },
  {
    files: [
      "website/docs/guides/customization.md",
      "website/docs/reference/skills.md",
      "website/docs/reference/commands/agent-commands.md",
    ],
    token: "rule-customize",
    replacement: "the /hatch3r-customize skill",
  },
  {
    files: [
      "website/docs/guides/customization.md",
      "website/docs/reference/skills.md",
      "website/docs/reference/commands/agent-commands.md",
    ],
    token: "skill-customize",
    replacement: "the /hatch3r-customize skill",
  },
];

interface StaleTokenResult {
  file: string;
  token: string;
  replacement: string;
}

/**
 * Enumeration drift probes (Cycle 11 D10-2, P3 docs currency + P4 lean coverage).
 *
 * Count probes assert a *number* matches; these assert *presence* — every
 * canonical artifact in an inventory class appears as a row on its website
 * reference page, so an added/renamed artifact that nobody documented is a
 * build failure (the root cause of the unguarded reference-page drift in
 * D10-2's F1/F3/F4). Each entry maps an `InventoryFiles` class key to its
 * `website/docs/reference/*.md` page.
 *
 * The reference pages strip the `hatch3r-` prefix and list artifacts by display
 * name in bold table cells (e.g. canonical `hatch3r-a11y-audit` →
 * `**a11y-audit**`), so `docTokensFor` derives candidate tokens from the
 * filename (NOT the frontmatter `id`, which can be a composite like
 * `ci-failure-ci-watcher` that the docs never use). A class match succeeds when
 * any candidate token appears verbatim on the page. Detail-rules
 * (`detail_rule: true`) are internal reference material consumed by a parent
 * rule per `.claude/rules/content-authoring.md`; they carry no standalone doc
 * row and are excluded via `ENUMERATION_EXCLUDE`.
 */
interface EnumerationProbe {
  /** Key into `InventoryFiles` whose entries are checked for doc presence. */
  filesKey: keyof InventoryFiles;
  /** Reference page (repo-relative) that must enumerate every member. */
  page: string;
  /** Human label for the class, used in the failure message. */
  label: string;
}

const ENUMERATION_PROBES: EnumerationProbe[] = [
  { filesKey: "agents", page: "website/docs/reference/agents.md", label: "agent" },
  { filesKey: "skills", page: "website/docs/reference/skills.md", label: "skill" },
  { filesKey: "rules", page: "website/docs/reference/rules.md", label: "rule" },
  { filesKey: "hooks", page: "website/docs/reference/hooks.md", label: "hook" },
];

/**
 * Canonical filenames excluded from enumeration coverage. `agent-orchestration`
 * has a `*-detail` companion (`detail_rule: true`) that is internal reference
 * material with no standalone reference-page row; keyed by the prefix-stripped
 * filename token so the probe and this set speak the same dialect.
 */
const ENUMERATION_EXCLUDE = new Set<string>(["agent-orchestration-detail"]);

/**
 * Candidate doc tokens for a canonical filename. Strips the `hatch3r-` prefix
 * and any `.md`/`/SKILL.md` suffix, then offers the plain token plus a `-rule`
 * variant. The `-rule` variant covers CQ/security measurement rules whose
 * filename is `hatch3r-<x>.md` but whose reference-page label is `**<x>-rule**`
 * (matching their frontmatter id `hatch3r-<x>-rule`), e.g. `hatch3r-security.md`
 * → doc row `**security-rule**`.
 */
function docTokensFor(fileName: string): string[] {
  const base = fileName.replace(/\/SKILL\.md$/, "").replace(/\.md$/, "");
  const short = base.startsWith("hatch3r-")
    ? base.slice("hatch3r-".length)
    : base;
  return [short, `${short}-rule`];
}

interface EnumerationResult {
  page: string;
  label: string;
  id: string;
}

/**
 * For each enumeration probe, read its reference page once and assert every
 * non-excluded canonical id in the class has a candidate token present. A miss
 * means the class gained an artifact the reference page never documented.
 * Exported for unit coverage.
 */
export async function checkEnumerationDrift(
  files: InventoryFiles,
): Promise<EnumerationResult[]> {
  const misses: EnumerationResult[] = [];
  for (const probe of ENUMERATION_PROBES) {
    const absPath = join(ROOT, probe.page);
    let contents: string;
    try {
      contents = await readFile(absPath, "utf-8");
    } catch (err) {
      // A missing reference page is itself drift: every listed id is unmatched.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        for (const id of files[probe.filesKey]) {
          misses.push({ page: probe.page, label: probe.label, id });
        }
        continue;
      }
      throw err;
    }
    for (const id of files[probe.filesKey]) {
      const base = id.replace(/\/SKILL\.md$/, "").replace(/\.md$/, "");
      const short = base.startsWith("hatch3r-")
        ? base.slice("hatch3r-".length)
        : base;
      if (ENUMERATION_EXCLUDE.has(short)) continue;
      const present = docTokensFor(id).some((token) =>
        contents.includes(token),
      );
      if (!present) {
        misses.push({ page: probe.page, label: probe.label, id });
      }
    }
  }
  return misses;
}

/**
 * Marketplace-description count probes (Cycle 11 D17-8, P3 docs currency).
 *
 * The external-surface description (GitHub About / social-preview card /
 * marketplace + plugin-hub blurbs) is the framework's public count claim. The
 * GitHub About field is not a repo file, but its canonical text lives in
 * `docs/marketplace-submission.md` (the headline description blurbs and the
 * embedded `plugin.json` description). D17-8 found that copy stale ("64 rules"
 * vs an inventory of 66), so these probes assert the marketplace description
 * counts equal `inventory.json` — the same guard the count-drift probes give
 * README/CLAUDE.md/plugin.json, extended to the public-marketing surface. The
 * regexes target the description blurbs (`NN <class>` inside the one-line, long,
 * embedded-manifest, and PR-style descriptions); each `<class>` literal in
 * those blurbs is identical, so one count-per-class probe covers all four
 * blurbs at once.
 */
const MARKETPLACE_DESCRIPTION_FILE = "docs/marketplace-submission.md";

const MARKETPLACE_PROBES: { label: string; expected: keyof InventoryCounts; regex: RegExp }[] =
  [
    { label: "marketplace description agents count", expected: "agents", regex: /(\d+)\s+agents,/ },
    { label: "marketplace description skills count", expected: "skills", regex: /(\d+)\s+skills,/ },
    { label: "marketplace description rules count", expected: "rules", regex: /(\d+)\s+rules,/ },
    { label: "marketplace description commands count", expected: "commands", regex: /(\d+)\s+commands,/ },
  ];

interface MarketplaceDriftResult {
  label: string;
  expected: number;
  found: number | null;
}

/**
 * Assert the marketplace-description count literals equal the inventory counts.
 * Returns `[]` when the description file is absent (ENOENT) so the probe is a
 * no-op in a checkout that does not ship the marketing surface. Exported for
 * unit coverage.
 */
export async function checkMarketplaceDescriptionDrift(
  counts: InventoryCounts,
): Promise<MarketplaceDriftResult[]> {
  const absPath = join(ROOT, MARKETPLACE_DESCRIPTION_FILE);
  let contents: string;
  try {
    contents = await readFile(absPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const drifts: MarketplaceDriftResult[] = [];
  for (const probe of MARKETPLACE_PROBES) {
    const match = contents.match(probe.regex);
    const expected = counts[probe.expected];
    if (!match) {
      drifts.push({ label: probe.label, expected, found: null });
      continue;
    }
    const found = Number.parseInt(match[1], 10);
    if (found !== expected) {
      drifts.push({ label: probe.label, expected, found });
    }
  }
  return drifts;
}

/**
 * Orphaned-agent probe (Cycle 11 D16-11, P4 lean coverage + P5 governance self-quality).
 *
 * D16-11 found `hatch3r-dependency-drafter` orphaned: no functional consumer and
 * no `agentPipeline` membership, its sole inbound being the §0 trigger-list row in
 * the shared `agents/shared/clarification-default-block.md` registry. A registry
 * row is a structural obligation (every agent appears there), not a consumer — so
 * an agent whose ONLY inbound is a shared registry block earns no existence under
 * P4 and crosses the D16.3 removal threshold. This probe flags that pattern so a
 * future orphan is caught at CI time rather than at the next manual audit.
 *
 * An agent is orphaned when zero canonical content files outside the agent's own
 * file AND outside the shared-registry directory (`agents/shared/`) reference its
 * id. Membership in any `commands/hatch3r-*.md` `agentPipeline:` array counts as a
 * functional consumer because those command files are inside the scanned set. The
 * `agents/shared/` exclusion is the crux: those files (clarification-default-block,
 * quality-charter, etc.) enumerate agent ids in registry tables and examples, which
 * is exactly the non-consumer inbound D16-11 ruled out. `src/` runtime wiring
 * (agentToolAllowlist, adapter code) is out of scope — the finding's orphan test is
 * about content consumers (functional consumer / pipeline), not runtime plumbing.
 */
const ORPHAN_SCAN_DIRS = [
  "agents",
  "skills",
  "commands",
  "rules",
  "hooks",
] as const;

/**
 * Canonical content subtree excluded from the inbound-consumer scan: shared
 * reference blocks that list every agent id by obligation, not as a consumer.
 * A reference inside this prefix never clears the orphan condition (D16-11).
 */
const ORPHAN_REGISTRY_PREFIX = join("agents", "shared");

interface OrphanResult {
  /** The orphaned agent's id (e.g. `hatch3r-dependency-drafter`). */
  id: string;
}

/**
 * Recursively list every `*.md` file under a directory, repo-relative. Returns
 * `[]` for a missing directory so the probe degrades to a no-op rather than
 * throwing in a partial checkout.
 */
async function listMarkdownTree(relDir: string): Promise<string[]> {
  const absDir = join(ROOT, relDir);
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const name of entries) {
    const relPath = join(relDir, name);
    const s = await stat(join(ROOT, relPath));
    if (s.isDirectory()) {
      out.push(...(await listMarkdownTree(relPath)));
    } else if (name.endsWith(".md")) {
      out.push(relPath);
    }
  }
  return out;
}

/**
 * Flag every canonical agent whose only inbound reference is a shared registry
 * block (D16-11). Reads each scanned markdown file once, then for each agent id
 * asserts at least one non-self, non-registry file mentions it. Exported for
 * unit coverage.
 */
export async function checkOrphanAgents(
  files: InventoryFiles,
): Promise<OrphanResult[]> {
  // Gather the scan corpus once: repo-relative path + contents.
  const corpus: { path: string; contents: string }[] = [];
  for (const dir of ORPHAN_SCAN_DIRS) {
    for (const relPath of await listMarkdownTree(dir)) {
      corpus.push({ path: relPath, contents: await readFile(join(ROOT, relPath), "utf-8") });
    }
  }
  const orphans: OrphanResult[] = [];
  for (const agentFile of files.agents) {
    const id = agentFile.replace(/\.md$/, "");
    const selfPath = join("agents", agentFile);
    const hasConsumer = corpus.some(
      (entry) =>
        entry.path !== selfPath &&
        !entry.path.startsWith(ORPHAN_REGISTRY_PREFIX) &&
        entry.contents.includes(id),
    );
    if (!hasConsumer) orphans.push({ id });
  }
  return orphans;
}

/**
 * Dangling domain-file agent-reference probe (Cycle 11 D23-8 + SA23.1-F5,
 * P5 governance self-quality + P2 scientific quality).
 *
 * Audit-domain files (`governance/audit/domains/D*.md`) cite canonical agents as
 * tabulation targets ("flag any step absent from `agents/hatch3r-X.md`"). When
 * the cited agent does not exist, an audit sub-agent binding to it reaches a
 * false conclusion against a non-existent surface — exactly the D23 file's
 * dangling `agents/hatch3r-verifier.md` (line 57, D23-8) and
 * `agents/hatch3r-planner.md` (line 43, SA23.1-F5), where the real eval and
 * planning surfaces are rule/command/architect files. This probe greps every
 * domain file for `agents/hatch3r-<name>.md` citations and fails when the cited
 * file is absent from `agents/`, so a future dangling agent reference in any
 * domain file is caught at CI time rather than at the next manual audit.
 *
 * Scope is the agent class only (`agents/hatch3r-*.md`): agents are the surface
 * whose dangling citations silently mis-route audit sub-agents. Other path
 * classes (rules/skills/commands) are held by the cross-reference validator in
 * `src/cli/commands/validate.ts`; this probe closes the domain-file → agent gap
 * that validator does not scan.
 */
const DOMAIN_DIR = join("governance", "audit", "domains");

/** Matches `agents/hatch3r-<name>.md` path citations in domain-file prose. */
const DOMAIN_AGENT_REF_RE = /agents\/(hatch3r-[a-z0-9-]+\.md)/g;

interface DanglingAgentRefResult {
  /** Repo-relative domain file that carries the dangling citation. */
  file: string;
  /** The cited agent filename that does not exist (e.g. `hatch3r-verifier.md`). */
  ref: string;
}

/**
 * Scan every `governance/audit/domains/D*.md` for `agents/hatch3r-*.md`
 * citations and report each one whose target file is absent from `agents/`.
 * Reads the live `agents/` listing once, then greps each domain file. Returns
 * `[]` when either directory is absent (ENOENT) so the probe is a no-op in a
 * partial checkout. Exported for unit coverage; `opts` lets a hermetic test
 * point both directories at a tmpdir instead of the repo root.
 */
export async function checkDanglingDomainAgentRefs(opts?: {
  /** Absolute path to the agents directory. Defaults to `<ROOT>/agents`. */
  agentsDir?: string;
  /** Absolute path to the audit-domains directory. Defaults to the repo path. */
  domainsDir?: string;
}): Promise<DanglingAgentRefResult[]> {
  const agentsDir = opts?.agentsDir ?? join(ROOT, "agents");
  const domainsDir = opts?.domainsDir ?? join(ROOT, DOMAIN_DIR);
  // Live set of existing agent filenames (e.g. `hatch3r-reviewer.md`).
  let agentFiles: Set<string>;
  try {
    agentFiles = new Set(
      (await readdir(agentsDir)).filter((n) => n.endsWith(".md")),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let domainEntries: string[];
  try {
    domainEntries = await readdir(domainsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const hits: DanglingAgentRefResult[] = [];
  for (const name of domainEntries) {
    if (!name.endsWith(".md")) continue;
    const contents = await readFile(join(domainsDir, name), "utf-8");
    const seen = new Set<string>();
    for (const match of contents.matchAll(DOMAIN_AGENT_REF_RE)) {
      const ref = match[1];
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (!agentFiles.has(ref)) {
        // Report the domain file by its repo-relative path for the CI message.
        hits.push({ file: join(DOMAIN_DIR, name), ref });
      }
    }
  }
  return hits;
}

/**
 * Scan each probe's files for its forbidden token. A hit means a consumer doc
 * still cites a decommissioned identifier. Exported for unit coverage.
 */
export async function checkStaleTokens(): Promise<StaleTokenResult[]> {
  const hits: StaleTokenResult[] = [];
  for (const probe of STALE_TOKEN_PROBES) {
    for (const file of probe.files) {
      const absPath = join(ROOT, file);
      let contents: string;
      try {
        contents = await readFile(absPath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      if (contents.includes(probe.token)) {
        hits.push({
          file,
          token: probe.token,
          replacement: probe.replacement,
        });
      }
    }
  }
  return hits;
}

/**
 * Version-drift probes (bugbot C1-PR54-5).
 *
 * Cross-checks that manifest files outside `package.json` stay pinned to the
 * same semver string. `package.json.version` is the single source of truth;
 * release-prep bumps it and this probe catches drift in downstream copies.
 */
interface VersionProbe {
  file: string;
  label: string;
  regex: RegExp;
}

const VERSION_PROBES: VersionProbe[] = [
  {
    file: ".claude-plugin/plugin.json",
    label: "Claude plugin manifest version",
    regex: /"version":\s*"([^"]+)"/,
  },
  {
    file: "docs/marketplace-submission.md",
    label: "Marketplace-submission embedded manifest version",
    regex: /"version":\s*"([^"]+)"/,
  },
];

interface VersionDriftResult {
  file: string;
  label: string;
  expected: string;
  found: string | null;
}

async function checkVersionDrift(): Promise<VersionDriftResult[]> {
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
    version: string;
  };
  const expected = pkg.version;
  const drifts: VersionDriftResult[] = [];
  for (const probe of VERSION_PROBES) {
    const absPath = join(ROOT, probe.file);
    let contents: string;
    try {
      contents = await readFile(absPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const match = contents.match(probe.regex);
    const found = match ? match[1] : null;
    if (found !== expected) {
      drifts.push({ file: probe.file, label: probe.label, expected, found });
    }
  }
  return drifts;
}

async function checkDocDrift(
  counts: InventoryCounts,
): Promise<DriftResult[]> {
  const drifts: DriftResult[] = [];
  for (const probe of DRIFT_PROBES) {
    const absPath = join(ROOT, probe.file);
    let contents: string;
    try {
      contents = await readFile(absPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const match = contents.match(probe.regex);
    const expected = counts[probe.expected];
    if (!match) {
      drifts.push({
        file: probe.file,
        label: probe.label,
        expected,
        found: null,
      });
      continue;
    }
    const found = Number.parseInt(match[1], 10);
    if (found !== expected) {
      drifts.push({ file: probe.file, label: probe.label, expected, found });
    }
  }
  return drifts;
}

/**
 * PRD enumeration self-check (D18-SA18.1-04, P5 governance self-quality + P4 lean coverage).
 *
 * `governance/hatch3r-prd.md` is gitignored (private strategy IP), so the CI
 * `--check-docs` count/version/enumeration probes cannot reach it — the PRD's
 * hand-maintained artifact enumerations drifted ~45-70% per class (§9 listed
 * 20/26/21/20 agents/skills/rules/commands against a shipped 29/53/70/31, §16
 * listed 6 of 9 hook events, §22 said "19 command files", and Appendix B carried
 * a "23-command set" / "30 agents"). Root cause: the PRD's §20.4 single-source
 * principle exempts its own enumerations and no ceremony re-derives them at
 * PRD-bump time. This is that ceremony — a LOCAL-ONLY `--check-prd` mode a
 * maintainer runs when editing the PRD. It is never wired into CI: the gitignored
 * file is absent in CI checkouts, so `checkPrdDrift` returns `null` (skip) there.
 * It re-derives the authoritative per-class counts from the live corpus
 * (`inventory.counts` + the `VALID_HOOK_EVENTS` SSoT) and flags the PRD's
 * locatable count sites that POSITIVELY disagree; a site whose phrasing it cannot
 * locate is an advisory (not a hard drift) so the check stays robust across the
 * recommended §9 regeneration. Counts are computed on the fly — no field is added
 * to the persisted inventory shape, so `governance/inventory.json` is unchanged.
 */
const PRD_FILE = join("governance", "hatch3r-prd.md");

interface PrdCountProbe {
  label: string;
  expected: keyof InventoryCounts;
  regex: RegExp;
}

/**
 * Locatable count sites in the PRD prose. Each regex targets a distinctive
 * descriptor so the probe binds to the intended site in the ~180 KB document and
 * not to a stray count elsewhere: §22's "NN command files", Appendix B's
 * "NN-command set" (Decision 13) and "of the NN agents" (Decisions 22/23). §9's
 * per-class tree is re-derived-and-printed (see `formatPrdReDerivation`) rather
 * than regex-probed — its recommended regenerated form (a class tree citing
 * inventory.json) has no stable count literal to anchor, so the printed
 * authoritative table guides that rewrite instead.
 */
const PRD_COUNT_PROBES: PrdCountProbe[] = [
  {
    label: "§22 CLI command-files count",
    expected: "cliCommands",
    regex: /(\d+)\s+command files/,
  },
  {
    label: "Appendix B Decision 13 command-set count",
    expected: "commands",
    regex: /(\d+)-command set/,
  },
  {
    label: "Appendix B Decisions 22/23 agent count",
    expected: "agents",
    regex: /of the (\d+) agents/,
  },
];

/** Total `--check-prd` probe count: the count-literal probes plus the §16 one. */
const PRD_PROBE_COUNT = PRD_COUNT_PROBES.length + 1;

interface PrdDriftResult {
  label: string;
  /** Authoritative count the PRD site must cite. */
  expected: number;
  /** Number found at the site, or `null` when the site could not be located. */
  found: number | null;
  /** Optional context, e.g. the missing §16 event names. */
  detail?: string;
}

/**
 * Slice the §16 "Hooks Architecture" section out of the PRD (from its numbered
 * header to the next top-level `## N.` header) so the hook-event presence check
 * binds to the §16 table and not to the event names that recur throughout the
 * document. Returns `null` when the §16 header is absent — an unlocated advisory,
 * not a drift. Anchored on the numbered-header text the PRD uses (`## 16. Hooks`).
 */
function sliceSection16(prd: string): string | null {
  const start = prd.search(/^##\s+16\.\s+Hooks/m);
  if (start === -1) return null;
  const rest = prd.slice(start + 1);
  const nextHeader = rest.search(/^##\s+\d+\./m);
  return nextHeader === -1
    ? prd.slice(start)
    : prd.slice(start, start + 1 + nextHeader);
}

/**
 * Re-derive the PRD's artifact enumerations from the live corpus and report the
 * PRD's locatable count sites that positively disagree. Returns `null` when the
 * gitignored PRD is absent (ENOENT) so `--check-prd` is a no-op in a CI checkout;
 * otherwise returns only the problem sites (a positively-wrong count carries a
 * numeric `found`; an unlocated site carries `found: null`). `opts.prdPath`
 * points the read at a fixture for hermetic tests. Exported for unit coverage.
 */
export async function checkPrdDrift(
  inventory: InventoryDocument,
  opts?: { prdPath?: string },
): Promise<PrdDriftResult[] | null> {
  const absPath = opts?.prdPath ?? join(ROOT, PRD_FILE);
  let prd: string;
  try {
    prd = await readFile(absPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const problems: PrdDriftResult[] = [];
  // Count-literal probes (§22 + Appendix B).
  for (const probe of PRD_COUNT_PROBES) {
    const expected = inventory.counts[probe.expected];
    const match = prd.match(probe.regex);
    if (!match) {
      problems.push({ label: probe.label, expected, found: null });
      continue;
    }
    const found = Number.parseInt(match[1], 10);
    if (found !== expected) {
      problems.push({ label: probe.label, expected, found });
    }
  }
  // §16 hook-events presence probe, derived from the VALID_HOOK_EVENTS SSoT
  // (src/hooks/types.ts) rather than a persisted inventory field.
  const expectedEvents = VALID_HOOK_EVENTS.size;
  const section16 = sliceSection16(prd);
  if (section16 === null) {
    problems.push({
      label: "§16 hook-events listed",
      expected: expectedEvents,
      found: null,
    });
  } else {
    const missing = [...VALID_HOOK_EVENTS].filter(
      (ev) => !section16.includes(`\`${ev}\``),
    );
    const found = expectedEvents - missing.length;
    if (found !== expectedEvents) {
      problems.push({
        label: "§16 hook-events listed",
        expected: expectedEvents,
        found,
        detail: `missing: ${missing.join(", ")}`,
      });
    }
  }
  return problems;
}

/**
 * The authoritative per-class counts the PRD's §9 tree / §16 table / §22 roster /
 * Appendix B decisions must cite, printed on every `--check-prd` run so a
 * maintainer regenerating those sections has the live numbers to hand. The
 * hook-event count comes from the `VALID_HOOK_EVENTS` SSoT; the rest from the
 * inventory just written this run.
 */
function formatPrdReDerivation(inventory: InventoryDocument): string {
  const c = inventory.counts;
  return [
    "inventory: PRD authoritative re-derivation (cite these; authoritative list = governance/inventory.json):",
    `  agents=${c.agents}  skills=${c.skills}  rules=${c.rules}  commands=${c.commands}`,
    `  CLI command files=${c.cliCommands}  hooks=${c.hooks}  hook events=${VALID_HOOK_EVENTS.size}  checks=${c.checks}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const checkDocs = process.argv.includes("--check-docs");
  const checkPrd = process.argv.includes("--check-prd");
  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(ROOT, "governance", "inventory.json");
  const fresh = await buildInventory(today);
  // Preserve the committed lastUpdated when the substantive content is
  // unchanged, so a no-op regen is byte-identical and the CI drift gate does
  // not flap on the date alone.
  const existing = await readExistingInventory(outPath);
  const inventory = reconcileLastUpdated(fresh, existing);
  const json = `${JSON.stringify(inventory, null, 2)}\n`;
  await writeFile(outPath, json, "utf-8");
  // eslint-disable-next-line no-console
  console.log(
    `inventory: wrote ${outPath} — ${inventory.counts.adapters} adapters, ` +
      `${inventory.counts.agents} agents, ${inventory.counts.skills} skills ` +
      `(${inventory.counts.cliSkills} CLI), ` +
      `${inventory.counts.rules} rules (.md) / ${inventory.counts.rulesMdc} (.mdc), ` +
      `${inventory.counts.commands} commands, ${inventory.counts.hooks} hooks, ` +
      `${inventory.counts.pipeline} pipeline modules, ${inventory.counts.cliCommands} CLI commands`,
  );

  // Local-only PRD enumeration self-check (D18-SA18.1-04). Never runs in CI —
  // the gitignored PRD is absent there and `checkPrdDrift` returns null (skip).
  // Runs independently of `--check-docs`; a positively-wrong PRD count exits 1.
  if (checkPrd) {
    const prdProblems = await checkPrdDrift(inventory);
    if (prdProblems === null) {
      // eslint-disable-next-line no-console
      console.log(
        "inventory: --check-prd skipped — governance/hatch3r-prd.md not present " +
          "(gitignored local-only surface; nothing to re-derive)",
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(formatPrdReDerivation(inventory));
      const hardDrifts = prdProblems.filter((d) => d.found !== null);
      const unlocated = prdProblems.filter((d) => d.found === null);
      for (const u of unlocated) {
        // eslint-disable-next-line no-console
        console.warn(
          `inventory: --check-prd advisory — ${u.label}: no checkable count located ` +
            `(expected ${u.expected}); write it in a form that cites inventory.json`,
        );
      }
      if (hardDrifts.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `inventory: PRD-drift FAIL — ${hardDrifts.length} PRD enumeration(s) disagree with the shipped corpus:`,
        );
        for (const d of hardDrifts) {
          // eslint-disable-next-line no-console
          console.error(
            `  - ${d.label}: expected ${d.expected}, found ${d.found}` +
              (d.detail ? ` (${d.detail})` : ""),
          );
        }
        process.exit(1);
      }
      // eslint-disable-next-line no-console
      console.log(
        `inventory: PRD-drift check PASS — ${PRD_PROBE_COUNT} probes, 0 positively-wrong counts`,
      );
    }
  }

  if (!checkDocs) return;

  const drifts = await checkDocDrift(inventory.counts);
  const versionDrifts = await checkVersionDrift();
  const staleTokens = await checkStaleTokens();
  const enumerationMisses = await checkEnumerationDrift(inventory.files);
  const marketplaceDrifts = await checkMarketplaceDescriptionDrift(
    inventory.counts,
  );
  const orphanAgents = await checkOrphanAgents(inventory.files);
  const danglingAgentRefs = await checkDanglingDomainAgentRefs();
  if (
    drifts.length === 0 &&
    versionDrifts.length === 0 &&
    staleTokens.length === 0 &&
    enumerationMisses.length === 0 &&
    marketplaceDrifts.length === 0 &&
    orphanAgents.length === 0 &&
    danglingAgentRefs.length === 0
  ) {
    // eslint-disable-next-line no-console
    console.log(
      `inventory: doc-drift check PASS — ${DRIFT_PROBES.length} count probes + ` +
        `${VERSION_PROBES.length} version probes + ${STALE_TOKEN_PROBES.length} stale-token probes + ` +
        `${ENUMERATION_PROBES.length} enumeration probes + ${MARKETPLACE_PROBES.length} marketplace probes + ` +
        `1 orphaned-agent probe + 1 dangling-domain-agent-ref probe, 0 drifts`,
    );
    return;
  }
  if (drifts.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: count-drift FAIL — ${drifts.length} of ${DRIFT_PROBES.length} probes report drift:`,
    );
    for (const d of drifts) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${d.file} [${d.label}]: expected ${d.expected}, ` +
          `found ${d.found === null ? "<no match>" : d.found}`,
      );
    }
  }
  if (versionDrifts.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: version-drift FAIL — ${versionDrifts.length} of ${VERSION_PROBES.length} probes report drift:`,
    );
    for (const d of versionDrifts) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${d.file} [${d.label}]: expected ${d.expected}, ` +
          `found ${d.found === null ? "<no match>" : d.found}`,
      );
    }
  }
  if (staleTokens.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: stale-token FAIL — ${staleTokens.length} consumer-doc references to decommissioned identifiers:`,
    );
    for (const h of staleTokens) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${h.file}: contains removed token "${h.token}" — use ${h.replacement}`,
      );
    }
  }
  if (enumerationMisses.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: enumeration-drift FAIL — ${enumerationMisses.length} canonical ids absent from their reference page:`,
    );
    for (const m of enumerationMisses) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${m.page}: ${m.label} "${m.id}" has no row — add it to the reference page`,
      );
    }
  }
  if (marketplaceDrifts.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: marketplace-description-drift FAIL — ${marketplaceDrifts.length} of ${MARKETPLACE_PROBES.length} counts in ${MARKETPLACE_DESCRIPTION_FILE} disagree with inventory.json:`,
    );
    for (const d of marketplaceDrifts) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${MARKETPLACE_DESCRIPTION_FILE} [${d.label}]: expected ${d.expected}, ` +
          `found ${d.found === null ? "<no match>" : d.found}`,
      );
    }
  }
  if (orphanAgents.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: orphaned-agent FAIL — ${orphanAgents.length} agent(s) whose only inbound is a shared registry block (no functional consumer, no agentPipeline):`,
    );
    for (const o of orphanAgents) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${o.id}: wire it into a consuming skill/command (Required Agent Delegation or agentPipeline) or decommission via /h4tcher-capability-remove per D16.3`,
      );
    }
  }
  if (danglingAgentRefs.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `inventory: dangling-domain-agent-ref FAIL — ${danglingAgentRefs.length} audit-domain citation(s) to a non-existent agents/hatch3r-*.md:`,
    );
    for (const d of danglingAgentRefs) {
      // eslint-disable-next-line no-console
      console.error(
        `  - ${d.file}: cites \`agents/${d.ref}\` which does not exist — repoint to the real surface or create the agent`,
      );
    }
  }
  process.exit(1);
}

// Only auto-run when executed as a script (not when imported by a test).
// resolve() on a string never throws, so no defensive catch is needed.
const isMain = resolve(process.argv[1] ?? "") === __filename;

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("inventory failed:", err);
    process.exit(1);
  });
}
