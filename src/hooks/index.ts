import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { HookDefinition } from "./types.js";
import { isValidHookEvent, VALID_HOOK_EVENTS } from "./types.js";

/**
 * Reason codes emitted by the hook parser when a definition is rejected.
 * Kept in sync with the Silent Failure Contract (CONSTITUTION.md §2 P5):
 * every rejection carries a machine-readable code so adapters and CI can
 * react without string-matching on free-form messages.
 *
 * C8-D2-M3 adds `SYMLINK_SKIPPED` so a symbolic link entry in
 * `.agents/hooks/` that would otherwise be parsed as a hook produces a
 * traceable diagnostic instead of a silent drop. Symlinks are a security
 * boundary (they can point outside the repo, or form cycles with recursive
 * readdir) and rejecting them here matches the behaviour already enforced
 * by `readSingleMd` in `src/adapters/canonical.ts`.
 */
export type HookParseErrorCode =
  | "NO_FRONTMATTER"
  | "YAML_PARSE_ERROR"
  | "MISSING_FIELD"
  | "INVALID_EVENT"
  | "DUPLICATE_ID"
  | "SYMLINK_SKIPPED";

/**
 * Read all hook definitions from `.agents/hooks/` by parsing YAML frontmatter.
 *
 * Each hook must have `id`, `event`, and `agent` in its frontmatter, and
 * `event` must be one of {@link VALID_HOOK_EVENTS}. Rejections are surfaced
 * via the optional `warnings` array — empty frontmatter, invalid YAML, a
 * typo'd event name, or a missing required field each produces a
 * `[hooks] CODE: file: message` line so operators see why a hook did not
 * register. Duplicate IDs across files are reported once (first wins).
 *
 * D5-SA5.7-H3 — Previously all rejection paths returned `null` silently,
 * which meant `event: PostToolUsee` (typo) looked identical to a correctly
 * parsed hook that simply had no effect. The warnings channel closes that
 * gap and satisfies the Silent Failure Contract.
 */
export async function readHookDefinitions(
  agentsDir: string,
  warnings?: string[],
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
    const fullPath = join(hooksDir, entry);
    // C8-D2-M3: lstat-gate every entry before reading. `readdir({recursive:true})`
    // walks through symlinked directories (and symlinked files) and can therefore
    // enumerate either cross-filesystem paths or cycles. Skipping symlinks here
    // matches the security boundary already enforced by `readSingleMd` in
    // `src/adapters/canonical.ts` (C7-H18), closes the infinite-recursion risk
    // identified in D2-SA2.2-3, and surfaces a SYMLINK_SKIPPED diagnostic so
    // the skip is not silent.
    let stats;
    try {
      stats = await lstat(fullPath);
    } catch (err) {
      // A race between readdir and lstat (file deleted mid-scan) is benign;
      // treat it as a skip rather than propagating. ENOENT here cannot affect
      // the remaining hooks.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (stats.isSymbolicLink()) {
      if (warnings) {
        warnings.push(
          formatHookWarning(fullPath, {
            code: "SYMLINK_SKIPPED",
            message: "symbolic link entry in hooks/ skipped (security boundary)",
          }),
        );
      }
      continue;
    }
    const content = await readFile(fullPath, "utf-8");
    const result = parseHookFrontmatter(content);
    if (result.error) {
      if (warnings) warnings.push(formatHookWarning(fullPath, result.error));
      continue;
    }
    const hook = result.hook;
    // #119: Prevent hook ID duplication across files
    if (seenIds.has(hook.id)) {
      if (warnings) {
        warnings.push(
          formatHookWarning(fullPath, {
            code: "DUPLICATE_ID",
            message: `hook id "${hook.id}" already registered from an earlier file (first wins)`,
          }),
        );
      }
      continue;
    }
    seenIds.add(hook.id);
    hooks.push(hook);
  }

  return hooks;
}

/** Shape a parser diagnostic for the warnings channel. */
function formatHookWarning(file: string, err: { code: HookParseErrorCode; message: string }): string {
  return `[hooks] ${err.code}: ${file}: ${err.message}`;
}

/**
 * Sanitize a hook field value that may be interpolated into shell commands
 * or TOML strings. Strips characters that could enable shell injection
 * (backticks, $, semicolons, pipes, newlines, null bytes).
 */
function sanitizeHookField(value: string): string {
  return value.replace(/[`$;|&\n\r\0\\'"]/g, "");
}

/**
 * Parse hook frontmatter from a markdown file.
 *
 * Returns a discriminated result: `{ hook }` on success, `{ error }` with a
 * machine-readable code when rejected. Callers of `readHookDefinitions`
 * receive these errors via the optional warnings channel; direct callers
 * (tests) can switch on `error.code` to assert specific failure modes.
 *
 * D5-SA5.7-H3 — Replaces the prior silent-null pattern that made a typo'd
 * event name (e.g. `event: pre-comit`) indistinguishable from a valid hook
 * that happened not to fire.
 */
function parseHookFrontmatter(
  content: string,
):
  | { hook: HookDefinition; error?: never }
  | { hook?: never; error: { code: HookParseErrorCode; message: string } } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { error: { code: "NO_FRONTMATTER", message: "no `---` delimited frontmatter block found" } };
  }

  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseYaml(match[1]) as Record<string, unknown> | null;
  } catch (err) {
    // The caller (loadHooks) consumes this error via the returned object and
    // pushes it onto the warnings[] channel — the catch IS the diagnostic
    // surface here. Build the structured error and return it.
    const errorResult = {
      error: {
        code: "YAML_PARSE_ERROR" as const,
        message: `frontmatter YAML is malformed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
    return errorResult;
  }
  if (!parsed || typeof parsed !== "object") {
    return { error: { code: "YAML_PARSE_ERROR", message: "frontmatter did not parse to an object" } };
  }

  const missing: string[] = [];
  if (!parsed.id) missing.push("id");
  if (!parsed.event) missing.push("event");
  if (!parsed.agent) missing.push("agent");
  if (missing.length > 0) {
    return {
      error: {
        code: "MISSING_FIELD",
        message: `required field(s) missing from frontmatter: ${missing.join(", ")}`,
      },
    };
  }

  const eventStr = String(parsed.event);
  if (!isValidHookEvent(eventStr)) {
    return {
      error: {
        code: "INVALID_EVENT",
        message: `event "${eventStr}" is not a valid hook event. Valid events: ${[...VALID_HOOK_EVENTS].sort().join(", ")}`,
      },
    };
  }

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

  return { hook };
}
