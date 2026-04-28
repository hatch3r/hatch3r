import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "../merge/safeWrite.js";

/**
 * Filter the on-disk `mcp.json` to only the selected MCP server names.
 *
 * Behavior mirrors the inlined logic in `init.ts` (post-content-copy MCP
 * pruning): read the JSON, restrict `mcpServers` keys to `selectedIds`, drop
 * the `_disabled` marker on each retained entry, and atomically rewrite. When
 * the file does not exist, no-op (ENOENT). Any other error is re-thrown.
 *
 * Used by `init` (initial filter after copying canonical content) and by
 * `update` (re-applying the filter after `update` re-copies the unfiltered
 * `mcp.json` from the package payload).
 */
export async function filterMcpJsonOnDisk(
  targetPath: string,
  selectedIds: Set<string>,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(targetPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  let parsed: { mcpServers?: Record<string, Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> };
  } catch (err) {
    if (err instanceof SyntaxError) return;
    throw err;
  }

  if (!parsed.mcpServers) return;

  const filtered: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    if (!selectedIds.has(name)) continue;
    const entry = { ...server };
    delete entry._disabled;
    filtered[name] = entry;
  }

  await atomicWriteFile(targetPath, JSON.stringify({ mcpServers: filtered }, null, 2) + "\n");
}
