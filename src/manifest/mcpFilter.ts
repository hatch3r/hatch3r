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
 * **Caller wiring (F1.6-H1, Cycle 10 D1).** This function is called only by
 * `init` (initial filter after copying the bundled `mcp.json` to
 * `.hatch3r/mcp/mcp.json` — see `init.ts` runInit MCP block). It is NOT called
 * by `update`: since Wave 3 the update path no longer materializes canonical
 * content into the repo (`runRegenerate` regenerates adapter outputs from the
 * bundled content root and does not re-copy `.hatch3r/mcp/mcp.json`), so there
 * is no unfiltered re-copy for `update` to re-filter. The earlier doc claim
 * that `update` re-applies this filter described the pre-Wave-3 `.agents/`
 * materialization flow that no longer exists. If a future change reintroduces
 * an `update`-time copy of `mcp.json`, wire `filterMcpJsonOnDisk` into that
 * path immediately after the copy to preserve the user's filtered subset.
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

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) return;
    throw err;
  }

  const rawServers = parsed.mcpServers;
  if (!rawServers || typeof rawServers !== "object") return;
  const mcpServers = rawServers as Record<string, Record<string, unknown>>;

  const filtered: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    if (!selectedIds.has(name)) continue;
    const entry = { ...server };
    delete entry._disabled;
    filtered[name] = entry;
  }

  // D11-M6 (Cycle 10 Wave-3 Medium, P2): preserve every top-level field beyond
  // `mcpServers` (e.g., `protocolVersion`, user-added documentation keys).
  // The prior writer emitted `{ mcpServers: filtered }` only, silently
  // destroying hand-edits at sibling keys on every re-init run. The MCP spec
  // and the Claude/Cursor/Copilot schemas all allow additional top-level
  // fields; restricting the rewrite to `mcpServers` is the minimal change
  // that preserves user state across the filter.
  const rewritten: Record<string, unknown> = { ...parsed, mcpServers: filtered };

  await atomicWriteFile(targetPath, JSON.stringify(rewritten, null, 2) + "\n");
}
