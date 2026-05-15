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
 * inventory matches the canonical "15 platform adapters" surface.
 */
const ADAPTER_UTILITIES = new Set<string>([
  "base.ts",
  "canonical.ts",
  "customization.ts",
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
   * pivot, plan §5). Added in 1.7.2 alongside the cliTools manifest field;
   * `cliSkills <= skills` always.
   */
  cliSkills: number;
  rules: number;
  rulesMdc: number;
  commands: number;
  hooks: number;
  pipeline: number;
  cliCommands: number;
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
}

interface InventoryDocument {
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

async function buildInventory(): Promise<InventoryDocument> {
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
  ]);

  // Use a date-only stamp (UTC) so the file is stable across same-day runs
  // and the CI drift check does not flap on every CI execution.
  const today = new Date().toISOString().slice(0, 10);

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
    },
  };
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
];

interface DriftResult {
  file: string;
  label: string;
  expected: number;
  found: number | null;
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
  const inventory = await buildInventory();
  const outPath = join(ROOT, "governance", "inventory.json");
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
  if (drifts.length === 0 && versionDrifts.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `inventory: doc-drift check PASS — ${DRIFT_PROBES.length} count probes + ${VERSION_PROBES.length} version probes, 0 drifts`,
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
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("inventory failed:", err);
  process.exit(1);
});
