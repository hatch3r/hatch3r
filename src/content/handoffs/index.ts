import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWriteFile } from "../../merge/safeWrite.js";
import {
  type Handoff,
  type HandoffFrontmatter,
  type HandoffStatus,
} from "./schema.js";
import {
  computeHandoffIntegrity,
  MAX_ACTIVE_HANDOFFS_PER_REPO,
  MAX_HANDOFF_BODY_BYTES,
  MAX_HANDOFF_FILE_BYTES,
  isHandoffExpired,
  validateHandoffContent,
} from "./validation.js";

// ── Re-exports ───────────────────────────────────────────────────

export {
  HANDOFF_STATUSES,
  VALID_STATUS_TRANSITIONS,
  isHandoffStatus,
  isValidStatusTransition,
} from "./schema.js";
export type { Handoff, HandoffFrontmatter, HandoffStatus } from "./schema.js";

export {
  HANDOFF_DEFAULT_EXPIRY_DAYS,
  HANDOFF_ID_PATTERN,
  MAX_ACTIVE_HANDOFFS_PER_REPO,
  MAX_HANDOFF_BODY_BYTES,
  MAX_HANDOFF_FILE_BYTES,
  MAX_SUMMARY_LENGTH,
  REQUIRED_BODY_SECTIONS,
  computeHandoffIntegrity,
  generateHandoffId,
  isHandoffExpired,
  validateHandoffContent,
  validateHandoffsDirectory,
  verifyHandoffIntegrity,
} from "./validation.js";
export type { HandoffValidationResult } from "./validation.js";

export {
  MAX_CONSENSUS_MESSAGES,
  fromConsensusPayload,
  toConsensusPayload,
} from "./payloadAdapter.js";
export type { ConsensusHandoffPayload } from "./payloadAdapter.js";

// ── Internal layout helpers ──────────────────────────────────────

const ACTIVE_DIR = "active";
const ARCHIVED_DIR = "archived";

function activePath(agentsDir: string, id: string): string {
  return join(agentsDir, "handoffs", ACTIVE_DIR, `${id}.md`);
}

function archivedPath(agentsDir: string, id: string): string {
  return join(agentsDir, "handoffs", ARCHIVED_DIR, `${id}.md`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Serialize a Handoff as `---\n<yaml>\n---\n<body>`. */
function serializeHandoff(handoff: Handoff): string {
  const yaml = stringifyYaml(handoff.frontmatter, { lineWidth: 0 });
  // YAML stringify already emits a trailing newline; trim then re-add to be
  // deterministic regardless of the yaml library's default.
  const trimmedYaml = yaml.replace(/\s+$/, "");
  const body = handoff.body.startsWith("\n") ? handoff.body : `\n${handoff.body}`;
  return `---\n${trimmedYaml}\n---${body}`;
}

/** Parse a handoff file's text into a {@link Handoff}; returns null on failure. */
function parseHandoffText(raw: string, filePath: string): Handoff | null {
  if (!raw.startsWith("---")) return null;
  const afterFirst = raw.slice(3);
  const newlineAfterFirst = afterFirst.indexOf("\n");
  if (newlineAfterFirst < 0) return null;
  const fmStart = newlineAfterFirst + 1;
  const closeMatch = afterFirst.slice(fmStart).match(/\n---\s*(?:\r?\n|$)/);
  if (!closeMatch || typeof closeMatch.index !== "number") return null;
  const yamlBlock = afterFirst.slice(fmStart, fmStart + closeMatch.index);
  const bodyStart = fmStart + closeMatch.index + closeMatch[0].length;
  const body = afterFirst.slice(bodyStart);
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch (err) {
    console.error(
      `hatch3r: failed to parse handoff frontmatter at ${filePath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  return {
    frontmatter: parsed as HandoffFrontmatter,
    body,
    filePath,
  };
}

/** Load every `.md` file in `dir` as a Handoff. Missing dir → empty. */
async function loadDir(dir: string): Promise<Handoff[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    // Silent Failure Contract: surface non-ENOENT failures.
    console.error(
      `hatch3r: failed to list handoff dir ${dir}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  const out: Handoff[] = [];
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(dir, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const h = parseHandoffText(raw, filePath);
      if (h) out.push(h);
      else {
        console.error(`hatch3r: failed to parse handoff at ${filePath}`);
      }
    } catch (err) {
      console.error(
        `hatch3r: failed to read handoff ${filePath}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}

// ── Public types ─────────────────────────────────────────────────

/** Cross-cutting indexes built from all handoffs in a repo. */
export interface HandoffIndex {
  active: Map<string, Handoff>;
  archived: Map<string, Handoff>;
  byWorkItem: Map<string, Handoff[]>;
  byBranch: Map<string, Handoff[]>;
}

/** Filter options for {@link listHandoffs}. */
export interface ListHandoffsFilter {
  status?: HandoffStatus | HandoffStatus[];
  workItem?: string;
  branch?: string;
  includeArchived?: boolean;
}

// ── writeHandoff ─────────────────────────────────────────────────

/**
 * Write a handoff to disk under `<agentsDir>/handoffs/active/<id>.md`
 * (or `archived/<id>.md` when `status === "archived"`).
 *
 * Flow: validate → recompute integrity → stamp `updated` if missing →
 * reject existing files unless `allowOverwrite` → soft-cap warning →
 * atomic write via {@link atomicWriteFile}.
 *
 * Returns the written path plus any validation/cap warnings.
 */
export async function writeHandoff(
  agentsDir: string,
  handoff: Handoff,
  options: { allowOverwrite?: boolean } = {},
): Promise<{ path: string; warnings: string[] }> {
  const warnings: string[] = [];
  const now = new Date();

  // Mutate a copy so we don't surprise the caller with reassigned fields.
  const fm: HandoffFrontmatter = { ...handoff.frontmatter };

  // Recompute integrity from body — authoritative.
  const computed = computeHandoffIntegrity(handoff.body);
  if (fm.integrity !== computed) fm.integrity = computed;

  // Stamp updated if missing or invalid.
  if (typeof fm.updated !== "string" || Number.isNaN(Date.parse(fm.updated))) {
    fm.updated = now.toISOString();
  }
  if (typeof fm.created !== "string" || Number.isNaN(Date.parse(fm.created))) {
    fm.created = fm.updated;
  }

  const updated: Handoff = { ...handoff, frontmatter: fm };

  // Validate after the integrity rewrite so the hash check passes.
  const validation = validateHandoffContent(updated, { skipInjectionScan: false });
  if (!validation.valid) {
    throw new HandoffWriteError(
      `Handoff "${fm.id}" is invalid: ${validation.errors.join("; ")}`,
    );
  }
  warnings.push(...validation.warnings);
  if (validation.driftWarnings) warnings.push(...validation.driftWarnings);

  const targetPath =
    fm.status === "archived"
      ? archivedPath(agentsDir, fm.id)
      : activePath(agentsDir, fm.id);

  // Reject overwrite unless explicitly allowed.
  if (!options.allowOverwrite && (await fileExists(targetPath))) {
    throw new HandoffWriteError(
      `Handoff already exists at ${targetPath}; pass allowOverwrite to replace.`,
    );
  }

  // Soft cap warning when adding to active.
  if (fm.status !== "archived") {
    const activeDir = join(agentsDir, "handoffs", ACTIVE_DIR);
    let activeCount = 0;
    try {
      const entries = await readdir(activeDir);
      activeCount = entries.filter((f) => f.endsWith(".md")).length;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        warnings.push(
          `Failed to read active handoff count: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // Count new file too unless it already exists (overwrite path).
    const willExceed = activeCount + ((await fileExists(targetPath)) ? 0 : 1);
    if (willExceed > MAX_ACTIVE_HANDOFFS_PER_REPO) {
      warnings.push(
        `Active handoff count will be ${willExceed}, exceeding soft cap ` +
          `${MAX_ACTIVE_HANDOFFS_PER_REPO}. Archive completed handoffs.`,
      );
    }
  }

  // Validate serialized file size before writing.
  const serialized = serializeHandoff(updated);
  const fileBytes = Buffer.byteLength(serialized, "utf-8");
  if (fileBytes > MAX_HANDOFF_FILE_BYTES) {
    throw new HandoffWriteError(
      `Serialized handoff exceeds ${MAX_HANDOFF_FILE_BYTES} byte limit ` +
        `(${fileBytes} bytes). Compact frontmatter or body.`,
    );
  }
  const bodyBytes = Buffer.byteLength(updated.body, "utf-8");
  if (bodyBytes > MAX_HANDOFF_BODY_BYTES) {
    throw new HandoffWriteError(
      `Handoff body exceeds ${MAX_HANDOFF_BODY_BYTES} byte limit (${bodyBytes} bytes).`,
    );
  }

  // mkdir -p then atomic write.
  await mkdir(join(targetPath, ".."), { recursive: true });
  await atomicWriteFile(targetPath, serialized);

  return { path: targetPath, warnings };
}

/** Error class for write-path failures (used in lieu of plain Error). */
class HandoffWriteError extends Error {
  exitCode = 1;
  errorCode = "HANDOFF_WRITE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "HandoffWriteError";
  }
}

// ── listHandoffs ─────────────────────────────────────────────────

/**
 * List handoffs under `<agentsDir>/handoffs/`, optionally filtered.
 *
 * Active handoffs are always scanned; archived included only when
 * `filter.includeArchived === true`. Results are sorted by `updated`
 * descending (newest first).
 */
export async function listHandoffs(
  agentsDir: string,
  filter: ListHandoffsFilter = {},
): Promise<Handoff[]> {
  const root = join(agentsDir, "handoffs");
  const active = await loadDir(join(root, ACTIVE_DIR));
  const archived = filter.includeArchived
    ? await loadDir(join(root, ARCHIVED_DIR))
    : [];
  let all = [...active, ...archived];

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    const set = new Set(statuses);
    all = all.filter((h) => set.has(h.frontmatter.status));
  }
  if (filter.workItem) {
    all = all.filter((h) => h.frontmatter.work_item === filter.workItem);
  }
  if (filter.branch) {
    all = all.filter((h) => h.frontmatter.branch === filter.branch);
  }

  all.sort((a, b) => {
    const aTime = Date.parse(a.frontmatter.updated) || 0;
    const bTime = Date.parse(b.frontmatter.updated) || 0;
    return bTime - aTime;
  });
  return all;
}

// ── readHandoff ──────────────────────────────────────────────────

/**
 * Read a single handoff by id. Searches `active/` first, then `archived/`.
 * Returns null when not found.
 */
export async function readHandoff(agentsDir: string, id: string): Promise<Handoff | null> {
  const root = join(agentsDir, "handoffs");
  for (const dir of [ACTIVE_DIR, ARCHIVED_DIR]) {
    const path = join(root, dir, `${id}.md`);
    try {
      const raw = await readFile(path, "utf-8");
      const h = parseHandoffText(raw, path);
      if (h) return h;
      console.error(`hatch3r: failed to parse handoff at ${path}`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(
          `hatch3r: failed to read handoff ${path}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return null;
}

// ── archiveHandoff ───────────────────────────────────────────────

/**
 * Move a handoff from `active/` to `archived/`, updating
 * `frontmatter.status` to `"archived"`, stamping `updated`, and setting
 * `superseded_by` when `reason === "superseded"`.
 *
 * Returns the source and destination paths. The move is staged as
 * "write new + rename" so the artifact is never in a torn state.
 */
export async function archiveHandoff(
  agentsDir: string,
  id: string,
  reason: "completed" | "expired" | "superseded" | "manual",
  options: { supersededBy?: string } = {},
): Promise<{ from: string; to: string }> {
  const from = activePath(agentsDir, id);
  const to = archivedPath(agentsDir, id);

  let raw: string;
  try {
    raw = await readFile(from, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new HandoffArchiveError(
        `Cannot archive: no active handoff "${id}" at ${from}.`,
      );
    }
    throw err;
  }
  const parsed = parseHandoffText(raw, from);
  if (!parsed) {
    throw new HandoffArchiveError(`Cannot archive: handoff "${id}" at ${from} is unparseable.`);
  }

  const fm: HandoffFrontmatter = { ...parsed.frontmatter };
  fm.status = "archived";
  fm.updated = new Date().toISOString();
  if (reason === "superseded" && options.supersededBy) {
    fm.superseded_by = options.supersededBy;
  }
  // Tag the archive reason via the tag list so downstream tools can filter.
  const tagSuffix = `archived:${reason}`;
  const tags = Array.isArray(fm.tags) ? [...fm.tags] : [];
  if (!tags.includes(tagSuffix)) tags.push(tagSuffix);
  fm.tags = tags;

  const newHandoff: Handoff = { frontmatter: fm, body: parsed.body, filePath: to };
  const serialized = serializeHandoff(newHandoff);

  await mkdir(join(to, ".."), { recursive: true });
  await atomicWriteFile(to, serialized);
  // Remove the original after the archive copy is durable.
  try {
    await unlink(from);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(
        `hatch3r: archive wrote ${to} but failed to remove ${from}: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          "Remove the active copy manually to avoid duplicate handoffs.",
      );
    }
  }

  return { from, to };
}

/** Error class for archive failures. */
class HandoffArchiveError extends Error {
  exitCode = 1;
  errorCode = "HANDOFF_ARCHIVE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "HandoffArchiveError";
  }
}

// ── pruneHandoffs ────────────────────────────────────────────────

const DEFAULT_PRUNE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Prune handoffs:
 *   - active/  → archive any expired (per {@link isHandoffExpired})
 *   - archived/→ delete any older than `olderThanDays` (default 90)
 *
 * `dryRun: true` returns the candidates without performing any moves
 * or deletions.
 */
export async function pruneHandoffs(
  agentsDir: string,
  options: { dryRun?: boolean; olderThanDays?: number; now?: Date } = {},
): Promise<{ archived: string[]; deleted: string[]; warnings: string[] }> {
  const dryRun = options.dryRun ?? false;
  const olderThanDays = options.olderThanDays ?? DEFAULT_PRUNE_DAYS;
  const now = options.now ?? new Date();
  const archived: string[] = [];
  const deleted: string[] = [];
  const warnings: string[] = [];

  // ── Active → archived (expired) ──
  const activeList = await loadDir(join(agentsDir, "handoffs", ACTIVE_DIR));
  for (const h of activeList) {
    if (!isHandoffExpired(h, now)) continue;
    archived.push(h.frontmatter.id);
    if (dryRun) continue;
    try {
      await archiveHandoff(agentsDir, h.frontmatter.id, "expired");
    } catch (err) {
      warnings.push(
        `Failed to archive expired handoff "${h.frontmatter.id}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Archived → deleted (age cutoff) ──
  const archivedList = await loadDir(join(agentsDir, "handoffs", ARCHIVED_DIR));
  const cutoffMs = now.getTime() - olderThanDays * MS_PER_DAY;
  for (const h of archivedList) {
    const updatedMs = Date.parse(h.frontmatter.updated);
    if (Number.isNaN(updatedMs)) {
      warnings.push(
        `Archived handoff "${h.frontmatter.id}" has unparseable updated timestamp; skipping.`,
      );
      continue;
    }
    if (updatedMs > cutoffMs) continue;
    deleted.push(h.frontmatter.id);
    if (dryRun) continue;
    try {
      await unlink(h.filePath);
    } catch (err) {
      warnings.push(
        `Failed to delete old archived handoff "${h.frontmatter.id}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { archived, deleted, warnings };
}

// ── buildHandoffIndex ────────────────────────────────────────────

/**
 * Scan every handoff under `<agentsDir>/handoffs/` and build cross-cut
 * indexes by id (active/archived), by `work_item`, and by `branch`.
 */
export async function buildHandoffIndex(agentsDir: string): Promise<HandoffIndex> {
  const root = join(agentsDir, "handoffs");
  const activeList = await loadDir(join(root, ACTIVE_DIR));
  const archivedList = await loadDir(join(root, ARCHIVED_DIR));

  const active = new Map<string, Handoff>();
  for (const h of activeList) active.set(h.frontmatter.id, h);
  const archived = new Map<string, Handoff>();
  for (const h of archivedList) archived.set(h.frontmatter.id, h);

  const byWorkItem = new Map<string, Handoff[]>();
  const byBranch = new Map<string, Handoff[]>();
  for (const h of [...activeList, ...archivedList]) {
    const wi = h.frontmatter.work_item;
    if (typeof wi === "string" && wi.length > 0) {
      const list = byWorkItem.get(wi) ?? [];
      list.push(h);
      byWorkItem.set(wi, list);
    }
    const br = h.frontmatter.branch;
    if (typeof br === "string" && br.length > 0) {
      const list = byBranch.get(br) ?? [];
      list.push(h);
      byBranch.set(br, list);
    }
  }

  return { active, archived, byWorkItem, byBranch };
}

