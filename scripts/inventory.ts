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
  "toml-utils.ts",
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

async function main(): Promise<void> {
  const checkDocs = process.argv.includes("--check-docs");
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

  if (!checkDocs) return;

  const drifts = await checkDocDrift(inventory.counts);
  const versionDrifts = await checkVersionDrift();
  const staleTokens = await checkStaleTokens();
  const enumerationMisses = await checkEnumerationDrift(inventory.files);
  const marketplaceDrifts = await checkMarketplaceDescriptionDrift(
    inventory.counts,
  );
  const orphanAgents = await checkOrphanAgents(inventory.files);
  if (
    drifts.length === 0 &&
    versionDrifts.length === 0 &&
    staleTokens.length === 0 &&
    enumerationMisses.length === 0 &&
    marketplaceDrifts.length === 0 &&
    orphanAgents.length === 0
  ) {
    // eslint-disable-next-line no-console
    console.log(
      `inventory: doc-drift check PASS — ${DRIFT_PROBES.length} count probes + ` +
        `${VERSION_PROBES.length} version probes + ${STALE_TOKEN_PROBES.length} stale-token probes + ` +
        `${ENUMERATION_PROBES.length} enumeration probes + ${MARKETPLACE_PROBES.length} marketplace probes + ` +
        `1 orphaned-agent probe, 0 drifts`,
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
