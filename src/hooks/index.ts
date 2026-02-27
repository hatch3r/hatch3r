import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { HookDefinition } from "./types.js";

export async function readHookDefinitions(
  agentsDir: string,
): Promise<HookDefinition[]> {
  const hooksDir = join(agentsDir, "hooks");

  let entries: string[];
  try {
    const dirEntries = await readdir(hooksDir);
    entries = dirEntries.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const hooks: HookDefinition[] = [];

  for (const entry of entries) {
    const content = await readFile(join(hooksDir, entry), "utf-8");
    const hook = parseHookFrontmatter(content);
    if (hook) {
      hooks.push(hook);
    }
  }

  return hooks;
}

function parseHookFrontmatter(content: string): HookDefinition | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const parsed = parseYaml(match[1]) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return null;

  if (!parsed.id || !parsed.event || !parsed.agent) return null;

  const hook: HookDefinition = {
    id: String(parsed.id),
    event: String(parsed.event) as HookDefinition["event"],
    agent: String(parsed.agent),
    description: parsed.description ? String(parsed.description) : "",
  };

  const condition: HookDefinition["condition"] = {};
  let hasCondition = false;

  if (parsed.globs) {
    condition.globs = String(parsed.globs).split(",").map((g: string) => g.trim());
    hasCondition = true;
  }
  if (parsed.labels) {
    condition.labels = String(parsed.labels).split(",").map((l: string) => l.trim());
    hasCondition = true;
  }
  if (parsed.branches) {
    condition.branches = String(parsed.branches).split(",").map((b: string) => b.trim());
    hasCondition = true;
  }

  if (hasCondition) {
    hook.condition = condition;
  }

  return hook;
}
