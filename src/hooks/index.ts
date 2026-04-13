import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { HookDefinition } from "./types.js";
import { isValidHookEvent } from "./types.js";

/**
 * Read all hook definitions from `.agents/hooks/` by parsing YAML frontmatter.
 *
 * Each hook must have `id`, `event`, and `agent` in its frontmatter.
 * Duplicate IDs across files are silently deduplicated (first wins).
 */
export async function readHookDefinitions(
  agentsDir: string,
): Promise<HookDefinition[]> {
  const hooksDir = join(agentsDir, "hooks");

  // #121: Use recursive readdir to match canonical reader's pattern
  let entries: string[];
  try {
    const allEntries = await readdir(hooksDir, { recursive: true });
    entries = allEntries
      .filter((f) => typeof f === "string" && f.endsWith(".md"))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }

  const hooks: HookDefinition[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    const content = await readFile(join(hooksDir, entry), "utf-8");
    const hook = parseHookFrontmatter(content);
    if (hook) {
      // #119: Prevent hook ID duplication across files
      if (seenIds.has(hook.id)) continue;
      seenIds.add(hook.id);
      hooks.push(hook);
    }
  }

  return hooks;
}

/**
 * Sanitize a hook field value that may be interpolated into shell commands
 * or TOML strings. Strips characters that could enable shell injection
 * (backticks, $, semicolons, pipes, newlines, null bytes).
 */
function sanitizeHookField(value: string): string {
  return value.replace(/[`$;|&\n\r\0\\'"]/g, "");
}

/** Parse hook frontmatter from a markdown file. Returns null if required fields are missing or the event is invalid. */
function parseHookFrontmatter(content: string): HookDefinition | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const parsed = parseYaml(match[1]) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return null;

  if (!parsed.id || !parsed.event || !parsed.agent) return null;

  const eventStr = String(parsed.event);
  if (!isValidHookEvent(eventStr)) return null;

  // #1.18: Sanitize id and agent fields that get interpolated into
  // shell echo commands (e.g. Codex adapter hook output)
  const hook: HookDefinition = {
    id: sanitizeHookField(String(parsed.id)),
    event: eventStr,
    agent: sanitizeHookField(String(parsed.agent)),
    description: parsed.description ? String(parsed.description) : "",
  };

  const condition: HookDefinition["condition"] = {};
  let hasCondition = false;

  if (parsed.globs) {
    condition.globs = Array.isArray(parsed.globs)
      ? parsed.globs.map(String)
      : String(parsed.globs).split(",").map((s: string) => s.trim());
    hasCondition = true;
  }
  if (parsed.labels) {
    condition.labels = Array.isArray(parsed.labels)
      ? parsed.labels.map(String)
      : String(parsed.labels).split(",").map((s: string) => s.trim());
    hasCondition = true;
  }
  if (parsed.branches) {
    condition.branches = Array.isArray(parsed.branches)
      ? parsed.branches.map(String)
      : String(parsed.branches).split(",").map((s: string) => s.trim());
    hasCondition = true;
  }

  if (hasCondition) {
    hook.condition = condition;
  }

  return hook;
}
