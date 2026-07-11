import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveBundledContentRoot } from "../content/contentRoot.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { HATCH3R_DIR } from "../types.js";

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
/**
 * Restrict a parsed `mcpServers` map to `selectedIds`, dropping the
 * `_disabled` marker on each retained entry. Shared by
 * {@link filterMcpJsonOnDisk} (in-place filter) and
 * {@link materializeUserMcpJson} (bundled-template materialization).
 */
function filterServers(
  servers: Record<string, Record<string, unknown>>,
  selectedIds: Set<string>,
): Record<string, Record<string, unknown>> {
  const filtered: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (!selectedIds.has(name)) continue;
    const entry = { ...server };
    delete entry._disabled;
    filtered[name] = entry;
  }
  return filtered;
}

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

  const filtered = filterServers(mcpServers, selectedIds);

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

/**
 * Options for {@link materializeUserMcpJson}.
 */
export interface MaterializeUserMcpJsonOptions {
  /** Override the bundled template path (tests); default `<bundled-root>/mcp/mcp.json`. */
  bundledMcpPath?: string;
  /** Sink for non-fatal diagnostics (missing/unparseable template or target). */
  onWarn?: (message: string) => void;
}

/**
 * Materialize (or refresh) the user-repo MCP copy at
 * `<rootDir>/.hatch3r/mcp/mcp.json`, filtered to `selectedIds`.
 *
 * **D1-SA1.2-08 (Cycle 12 Wave 3, D1, P2).** Extraction of init's Wave-6
 * copy-then-filter block into a shared helper: before this, the user-repo copy
 * was written ONLY by init and froze at the init-time server set — while the
 * generated agent docs (`agentsMdGenerator.ts`, `bridgeOrchestration.ts`) name
 * it as THE MCP configuration for agents. Call this wherever the selected
 * server set changes so the copy tracks the manifest:
 *   - `init` (Wave 6 block, `init.ts` — existing behavior, extraction source)
 *   - `mcp setup` / `mcp remove` (`mcp.ts` — after the manifest mutation)
 *   - `runRegenerate` (`update.ts` — so `sync`/`update`/`config`/`verify --fix`
 *     refresh the copy alongside adapter outputs)
 * Wiring status: the three post-init call sites above are pending (their files
 * are owned by concurrent Cycle-12 work units); this module provides the
 * single maintained materialization point they converge on.
 *
 * Behavior:
 *   - Server DEFINITIONS always come from the bundled template (fresh copies,
 *     `_disabled` markers dropped), restricted to `selectedIds`.
 *   - When the target already exists and parses, its top-level sibling fields
 *     are preserved (D11-M6 contract) — only `mcpServers` is replaced.
 *   - `selectedIds` empty + target absent → no write (keep the directory
 *     absent rather than emitting an empty file, mirroring init).
 *   - `selectedIds` empty + target present → rewrite with `mcpServers: {}` so
 *     the copy stays truthful after a remove-to-zero.
 *   - Missing bundled template → `onWarn` + `false` (non-fatal, mirroring
 *     init's ENOENT tolerance). Unparseable existing target → `onWarn` +
 *     `false` (never clobber a file we cannot merge, mirroring
 *     {@link filterMcpJsonOnDisk}'s SyntaxError no-op).
 *
 * @returns `true` when the copy was written, `false` on any no-op path.
 */
export async function materializeUserMcpJson(
  rootDir: string,
  selectedIds: Set<string>,
  options: MaterializeUserMcpJsonOptions = {},
): Promise<boolean> {
  const warn = options.onWarn ?? (() => {});
  const bundledMcpPath =
    options.bundledMcpPath ?? join(resolveBundledContentRoot(), "mcp", "mcp.json");
  const targetDir = join(rootDir, HATCH3R_DIR, "mcp");
  const targetPath = join(targetDir, "mcp.json");

  // 1. Bundled template — the source of server definitions.
  let bundledRaw: string;
  try {
    bundledRaw = await readFile(bundledMcpPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      warn(
        `Bundled MCP template not found at ${bundledMcpPath}; ` +
          `${HATCH3R_DIR}/mcp/mcp.json not written.`,
      );
      return false;
    }
    throw err;
  }
  let bundledParsed: Record<string, unknown>;
  try {
    bundledParsed = JSON.parse(bundledRaw) as Record<string, unknown>;
  } catch {
    warn(
      `Bundled MCP template at ${bundledMcpPath} is not valid JSON; ` +
        `${HATCH3R_DIR}/mcp/mcp.json not written.`,
    );
    return false;
  }

  // 2. Existing target (optional) — the source of user sibling fields.
  let existingParsed: Record<string, unknown> | undefined;
  let targetExists = false;
  try {
    const existingRaw = await readFile(targetPath, "utf-8");
    targetExists = true;
    existingParsed = JSON.parse(existingRaw) as Record<string, unknown>;
  } catch (err) {
    if (targetExists) {
      // Read succeeded but parse failed: never overwrite a user file we
      // cannot merge (same fail-safe posture as filterMcpJsonOnDisk).
      warn(
        `${HATCH3R_DIR}/mcp/mcp.json exists but is not valid JSON; ` +
          `left untouched — fix or delete it, then re-run.`,
      );
      return false;
    }
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // 3. Empty selection: keep the directory absent when nothing exists yet.
  if (selectedIds.size === 0 && !targetExists) return false;

  // 4. Filter the BUNDLED server set (fresh definitions, `_disabled` dropped).
  const rawServers = bundledParsed.mcpServers;
  const bundledServers =
    rawServers && typeof rawServers === "object"
      ? (rawServers as Record<string, Record<string, unknown>>)
      : {};
  const filtered = filterServers(bundledServers, selectedIds);

  // 5. Merge: user siblings (when present) win the frame; bundled siblings
  //    seed a fresh materialization; `mcpServers` is always the filtered set.
  const base = existingParsed ?? bundledParsed;
  const rewritten: Record<string, unknown> = { ...base, mcpServers: filtered };

  await mkdir(targetDir, { recursive: true });
  await atomicWriteFile(targetPath, JSON.stringify(rewritten, null, 2) + "\n");
  return true;
}
