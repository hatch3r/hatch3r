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
import { readdir, stat, writeFile } from "node:fs/promises";
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

  return {
    lastUpdated: today,
    counts: {
      adapters: adapters.length,
      agents: agents.length,
      skills: skills.length,
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
      rules,
      rulesMdc,
      commands,
      hooks,
      pipeline,
      cliCommands,
    },
  };
}

async function main(): Promise<void> {
  const inventory = await buildInventory();
  const outPath = join(ROOT, "governance", "inventory.json");
  const json = `${JSON.stringify(inventory, null, 2)}\n`;
  await writeFile(outPath, json, "utf-8");
  // eslint-disable-next-line no-console
  console.log(
    `inventory: wrote ${outPath} — ${inventory.counts.adapters} adapters, ` +
      `${inventory.counts.agents} agents, ${inventory.counts.skills} skills, ` +
      `${inventory.counts.rules} rules (.md) / ${inventory.counts.rulesMdc} (.mdc), ` +
      `${inventory.counts.commands} commands, ${inventory.counts.hooks} hooks, ` +
      `${inventory.counts.pipeline} pipeline modules, ${inventory.counts.cliCommands} CLI commands`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("inventory failed:", err);
  process.exit(1);
});
