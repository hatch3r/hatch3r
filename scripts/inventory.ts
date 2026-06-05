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
import { join, dirname, resolve } from "node:path";
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
 * List every `*.md` file directly inside a companion-content directory
 * (F16.3-L2 / F16.3-M3). Unlike `listTopLevelMd`, companion files carry no
 * `hatch3r-` prefix requirement (they are reference material under named
 * support subdirectories per `.claude/rules/content-authoring.md`), so this
 * lists all top-level markdown, including any `README.md`. Returns `[]` for a
 * missing directory so the inventory stays stable if a directory is removed.
 */
async function listCompanionMd(relDir: string): Promise<string[]> {
  const dir = join(ROOT, relDir);
  const entries = await listEntries(dir);
  const results: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isFile()) results.push(name);
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
  if (
    drifts.length === 0 &&
    versionDrifts.length === 0 &&
    staleTokens.length === 0
  ) {
    // eslint-disable-next-line no-console
    console.log(
      `inventory: doc-drift check PASS — ${DRIFT_PROBES.length} count probes + ` +
        `${VERSION_PROBES.length} version probes + ${STALE_TOKEN_PROBES.length} stale-token probes, 0 drifts`,
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
