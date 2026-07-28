import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { sanitizeId } from "../types.js";

export type CustomizableType = "agents" | "skills" | "commands" | "rules";

const MAX_CUSTOMIZE_YAML_BYTES = 10_240;

export interface Customization {
  model?: string;
  /**
   * Reasoning-effort override (release/2.7.0 effort axis). Read exactly like
   * {@link model} (non-empty string); enum gating against the five effort
   * levels happens at apply time (src/adapters/customization.ts) and in
   * `hatch3r validate`, not at read time.
   */
  effort?: string;
  scope?: string;
  description?: string;
  enabled?: boolean;
}

export interface CustomizationReadResult {
  value: Customization | undefined;
  warnings: string[];
}

export type AgentCustomization = Customization;

/**
 * Read a `.customize.yaml` override for a content item.
 *
 * Looks for `.hatch3r/{type}/{id}.customize.yaml` relative to the project root.
 * Returns undefined if no customization file exists or the file is empty.
 */
export async function readCustomization(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<Customization | undefined> {
  const { value } = await readCustomizationWithWarnings(projectRoot, type, id);
  return value;
}

/**
 * Read a `.customize.yaml` override with structured warnings.
 *
 * Same as {@link readCustomization} but also returns any warnings
 * generated during parsing (e.g. oversized file, YAML errors).
 */
export async function readCustomizationWithWarnings(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<CustomizationReadResult> {
  const warnings: string[] = [];
  const safeId = sanitizeId(id);
  const filePath = join(projectRoot, ".hatch3r", type, `${safeId}.customize.yaml`);
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedBase)) {
    return { value: undefined, warnings };
  }
  const path = filePath;
  try {
    const raw = await readFile(path, "utf-8");
    if (Buffer.byteLength(raw, "utf-8") > MAX_CUSTOMIZE_YAML_BYTES) {
      warnings.push(`Customization YAML for "${id}" exceeds ${MAX_CUSTOMIZE_YAML_BYTES} bytes. Skipping.`);
      return { value: undefined, warnings };
    }
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return { value: undefined, warnings };

    // DD-C7 (release/2.8.5): surface unknown keys instead of silently
    // dropping them. The field-by-field reads below ignore anything outside
    // the known set, so a typo'd key (`modle: opus`) previously produced a
    // no-op override with zero signal — the same Silent Failure class as the
    // D2-12 YAML-parse warning this rides beside. Routed through the
    // existing warnings[] channel (init/sync/update/validate consumers).
    const KNOWN_CUSTOMIZE_KEYS = new Set(["model", "effort", "scope", "description", "enabled"]);
    const unknownKeys = Object.keys(parsed).filter((k) => !KNOWN_CUSTOMIZE_KEYS.has(k)).sort();
    if (unknownKeys.length > 0) {
      warnings.push(
        `Customization YAML for "${id}" contains unknown field(s) that are ignored: ` +
          `${unknownKeys.join(", ")}. Known fields: model, effort, scope, description, enabled.`,
      );
    }

    const result: Customization = {};
    let hasValue = false;

    if (typeof parsed.model === "string" && parsed.model.length > 0) {
      result.model = parsed.model;
      hasValue = true;
    }
    if (typeof parsed.effort === "string" && parsed.effort.length > 0) {
      result.effort = parsed.effort;
      hasValue = true;
    }
    if (typeof parsed.scope === "string" && parsed.scope.length > 0) {
      result.scope = parsed.scope;
      hasValue = true;
    }
    if (typeof parsed.description === "string" && parsed.description.length > 0) {
      result.description = parsed.description;
      hasValue = true;
    }
    if (typeof parsed.enabled === "boolean") {
      result.enabled = parsed.enabled;
      hasValue = true;
    }

    return { value: hasValue ? result : undefined, warnings };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const isYamlError = err instanceof Error && err.name.startsWith("YAML");
    if (code !== "ENOENT" && !isYamlError) throw err;
    // D2-12 (Cycle 11 Wave 3): a YAML parse error previously fell through to a
    // bare `{ value: undefined, warnings: [] }` with the warnings array empty,
    // so a user's `enabled: false`/override silently did nothing — a Silent
    // Failure Contract violation (CONSTITUTION §2 P5; cited in
    // src/adapters/customization.ts fail-closed block). ENOENT (no file) stays
    // a clean no-op, but a present-but-unparseable file is a user-visible error:
    // push a warning naming the file and the parse reason so init/sync/update
    // and `hatch3r validate` surface it through their `warnings[]` consumers
    // (readCustomizationSnapshot, validate.ts::validateCustomizationFields)
    // instead of dropping the override without a trace.
    if (isYamlError) {
      const reason = (err as Error).message.split("\n")[0];
      warnings.push(
        `Customization YAML for "${id}" failed to parse (${reason}). ` +
        `Overrides in this file are ignored — fix the YAML in ` +
        `.hatch3r/${type}/${safeId}.customize.yaml and re-run, or the customization has no effect.`,
      );
    }
    return { value: undefined, warnings };
  }
}

/**
 * D15 Medium (#15.37): Maximum size for `.customize.md` files in bytes.
 *
 * F2.3-H4 (Cycle 10 Wave 2): single source of truth per CONSTITUTION §2 P5
 * Anti-Bloat Principle 1. This constant was duplicated as a private `const` in
 * `src/adapters/customization.ts` — two independent `10_240` literals that a
 * future maintainer could change in one place and not the other, producing a
 * read-time vs apply-time byte-limit mismatch. Exported here so the adapter
 * layer imports the limit rather than re-declaring it.
 */
export const MAX_CUSTOMIZE_MD_BYTES = 10_240;

/**
 * F2.3-H4 (Cycle 10 Wave 2): protected-artifact byte cap for `.customize.md`.
 *
 * Protected canonical artifacts (e.g. security floors) accept a smaller user
 * append than ordinary artifacts. The value lives here alongside
 * {@link MAX_CUSTOMIZE_MD_BYTES} so both customization byte limits share one
 * declaration site; `src/adapters/customization.ts` consumes it at apply time.
 */
export const MAX_PROTECTED_CUSTOMIZE_MD_BYTES = 2_048;

export interface CustomizationMdReadResult {
  value: string | undefined;
  warnings: string[];
}

/**
 * Read a `.customize.md` content append for a content item.
 *
 * Looks for `.hatch3r/{type}/{id}.customize.md` relative to the project root.
 * Returns undefined if no file exists or the file is empty.
 *
 * D15 Medium (#15.37): Enforces content-length limit at read time so
 * oversized customization files are caught before they reach the adapter.
 */
export async function readCustomizationMarkdown(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<string | undefined> {
  const { value } = await readCustomizationMarkdownWithWarnings(projectRoot, type, id);
  return value;
}

/**
 * Read a `.customize.md` content append with structured warnings.
 *
 * Same as {@link readCustomizationMarkdown} but also returns warnings
 * (e.g. when the file exceeds the byte-length limit).
 */
export async function readCustomizationMarkdownWithWarnings(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<CustomizationMdReadResult> {
  const warnings: string[] = [];
  const safeId = sanitizeId(id);
  const filePath = join(projectRoot, ".hatch3r", type, `${safeId}.customize.md`);
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedBase)) {
    return { value: undefined, warnings };
  }
  const path = filePath;
  try {
    const content = await readFile(path, "utf-8");
    const byteLength = Buffer.byteLength(content, "utf-8");
    if (byteLength > MAX_CUSTOMIZE_MD_BYTES) {
      warnings.push(
        `Customization markdown for "${id}" exceeds ${MAX_CUSTOMIZE_MD_BYTES} byte limit ` +
        `(${byteLength} bytes). Content will be truncated.`,
      );
    }
    const trimmed = content.trim();
    return { value: trimmed.length > 0 ? trimmed : undefined, warnings };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { value: undefined, warnings };
  }
}

/**
 * Combined result of reading both YAML and MD customization files as a
 * time-consistent snapshot.
 */
export interface CustomizationSnapshot {
  yaml: Customization | undefined;
  md: string | undefined;
  warnings: string[];
}

async function statMtimeMs(path: string): Promise<number | undefined> {
  try {
    const s = await stat(path);
    return s.mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return undefined;
  }
}

/**
 * mtime observations for a customization pair (`.customize.yaml` +
 * `.customize.md`) captured at one instant. `undefined` means the file did not
 * exist at that observation (ENOENT); a number is the file's `mtimeMs`.
 */
export interface SnapshotMtimes {
  yaml: number | undefined;
  md: number | undefined;
}

/**
 * Pure TOCTOU drift comparator for {@link readCustomizationSnapshot}.
 *
 * Given the mtime observations captured before (`pre`) and after (`post`) the
 * customization reads, return the edit-during-sync warning(s). A file "changed"
 * when its pre- and post-observation differ — an mtime bump OR an existence
 * transition (`undefined` <-> number, i.e. ENOENT <-> present).
 *
 * Extracted from the snapshot reader (D3-SA3.4-07): detecting the race is
 * best-effort, but the warning emission GIVEN a detected mismatch is
 * deterministic pure logic (mtime inequality -> exact message + named files).
 * Isolating it here makes that logic unit-testable without racing a real
 * filesystem `utimes` bump against the read window, so a regression in the
 * message text, the recovery guidance, or the file naming fails a test
 * deterministically instead of only when the race happens to land. The
 * real-race integration tests stay as best-effort smoke.
 */
export function detectSnapshotDrift(
  type: CustomizableType,
  id: string,
  pre: SnapshotMtimes,
  post: SnapshotMtimes,
): string[] {
  const yamlChanged = pre.yaml !== post.yaml;
  const mdChanged = pre.md !== post.md;
  if (!yamlChanged && !mdChanged) return [];
  const which: string[] = [];
  if (yamlChanged) which.push(".customize.yaml");
  if (mdChanged) which.push(".customize.md");
  return [
    `Customization file(s) for "${id}" changed during sync (${which.join(", ")}). ` +
      `Snapshot may be inconsistent — the output for this run is based on a partial read. ` +
      `To regenerate cleanly: save all .hatch3r/${type}/*.customize.{yaml,md} edits, then ` +
      `run \`hatch3r sync\` (no flags needed).`,
  ];
}

/**
 * Read both `.customize.yaml` and `.customize.md` for a content item as a
 * time-consistent snapshot, guarding against TOCTOU (time-of-check to
 * time-of-use) edit-during-sync races (C8-D2-M4).
 *
 * Convention (enforced by warning, not by lock):
 * - Users must not edit customization files while a sync/update/init is in
 *   flight. The window is typically sub-second, but concurrent edits can
 *   produce an inconsistent snapshot where, for example, the YAML reflects
 *   `enabled: false` but the MD append was captured from a prior state.
 * - This function detects the race via stat-read-stat: it records the mtime
 *   of each file before reading, then re-stats after both reads complete.
 *   If either mtime or existence state (ENOENT <-> present) changed, a
 *   warning is emitted and returned in `warnings[]`. The caller surfaces
 *   it to the user.
 * - Detection is best-effort: mtime resolution is filesystem-dependent
 *   (typically 1ms to 1s). Sub-resolution edits cannot be detected; the
 *   warning documents the convention instead. Node.js fs.promises.readFile
 *   provides no atomic-across-calls guarantee (see nodejs.org/api/fs.html:
 *   "These operations are not synchronized or threadsafe"), so no
 *   in-process locking strategy can fully eliminate the race between two
 *   independent files.
 *
 * Both files are read concurrently (Promise.all) for latency parity with
 * the previous behavior.
 */
export async function readCustomizationSnapshot(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<CustomizationSnapshot> {
  const warnings: string[] = [];
  const safeId = sanitizeId(id);
  const yamlPath = join(projectRoot, ".hatch3r", type, `${safeId}.customize.yaml`);
  const mdPath = join(projectRoot, ".hatch3r", type, `${safeId}.customize.md`);

  const resolvedBase = resolve(projectRoot);
  const yamlSafe = resolve(yamlPath).startsWith(resolvedBase);
  const mdSafe = resolve(mdPath).startsWith(resolvedBase);

  // Pre-read stat (check): record the mtime observed before the reads start.
  const [yamlPreMtime, mdPreMtime] = await Promise.all([
    yamlSafe ? statMtimeMs(yamlPath) : Promise.resolve(undefined),
    mdSafe ? statMtimeMs(mdPath) : Promise.resolve(undefined),
  ]);

  // Concurrent reads (use): preserves the Promise.all latency pattern.
  const [yamlRead, mdRead] = await Promise.all([
    readCustomizationWithWarnings(projectRoot, type, id),
    readCustomizationMarkdownWithWarnings(projectRoot, type, id),
  ]);
  warnings.push(...yamlRead.warnings, ...mdRead.warnings);

  // Post-read stat (re-check): detect any mtime or existence change across
  // the read window. If either file changed, the snapshot may be inconsistent.
  const [yamlPostMtime, mdPostMtime] = await Promise.all([
    yamlSafe ? statMtimeMs(yamlPath) : Promise.resolve(undefined),
    mdSafe ? statMtimeMs(mdPath) : Promise.resolve(undefined),
  ]);

  warnings.push(
    ...detectSnapshotDrift(
      type,
      id,
      { yaml: yamlPreMtime, md: mdPreMtime },
      { yaml: yamlPostMtime, md: mdPostMtime },
    ),
  );

  return { yaml: yamlRead.value, md: mdRead.value, warnings };
}

