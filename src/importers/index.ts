/**
 * Migration-importer barrel + multi-format aggregator (F14.4-H1, D14, Cycle 10).
 *
 * Re-exports every competitor-format importer and provides `importAllFormats`,
 * the in-memory aggregation point a future `hatch3r init --import <format|auto>`
 * CLI flag consumes. The CLI wiring + disk-write + interactive summary are
 * cross-WU (owned by init.ts/program.ts, tracked under F14.4-H2); this module
 * stops at returning typed, in-memory canonical-rule objects grouped by source
 * format, exactly as the cursor parser baseline does.
 */
import { HatchError } from "../types.js";
import type { ImportedRule } from "./shared.js";
import { parseAwesomeCursorrulesFile } from "./awesomeCursorrules.js";
import { parseCopilotInstructionsDir } from "./copilot.js";
import { parseCursorRulesDir, type ImportedCursorRule } from "./cursor.js";
import { parseWindsurfRulesDir } from "./windsurf.js";
import { join } from "node:path";

export * from "./shared.js";
export * from "./cursor.js";
export * from "./copilot.js";
export * from "./windsurf.js";
export * from "./awesomeCursorrules.js";

/** Supported migration source formats. */
export type ImportFormat = "cursor" | "copilot" | "windsurf" | "cursorrules";

/** All importable source formats, in stable order. */
export const IMPORT_FORMATS: readonly ImportFormat[] = [
  "cursor",
  "copilot",
  "windsurf",
  "cursorrules",
] as const;

/** Rules imported from a single source format. */
export interface FormatImportResult {
  format: ImportFormat;
  rules: ImportedRule[];
}

/**
 * Run the importer for a single format against a repository root and return
 * its rules in canonical shape. The cursor format's `ImportedCursorRule` is
 * structurally assignable to `ImportedRule` (it adds no incompatible fields),
 * so the union return type is uniform.
 *
 * @param rootDir - Absolute path to the repository root directory.
 * @param format  - One of {@link IMPORT_FORMATS}.
 */
export async function importFormat(
  rootDir: string,
  format: ImportFormat,
): Promise<ImportedRule[]> {
  switch (format) {
    case "cursor": {
      const rules: ImportedCursorRule[] = await parseCursorRulesDir(
        join(rootDir, ".cursor", "rules"),
      );
      return rules;
    }
    case "copilot":
      return parseCopilotInstructionsDir(rootDir);
    case "windsurf":
      return parseWindsurfRulesDir(rootDir);
    case "cursorrules":
      return parseAwesomeCursorrulesFile(rootDir);
    default: {
      // Exhaustiveness guard: a new ImportFormat must add a case above.
      const never: never = format;
      throw new HatchError(
        `Unknown import format: ${String(never)}`,
        2,
        "VALIDATION_ERROR",
        `Pass one of: ${IMPORT_FORMATS.join(", ")}.`,
      );
    }
  }
}

/**
 * Run every importer against a repository root and return the rules grouped by
 * source format. Formats that find no source files yield an entry with an
 * empty `rules` array, so callers can report "0 found" per format. Importers
 * run in parallel — each reads disjoint source paths, so there is no shared
 * mutable state.
 *
 * Does NOT detect cross-format id collisions, write to disk, or report a
 * summary — those slices are cross-WU (F14.4-H2 / init.ts).
 *
 * @param rootDir - Absolute path to the repository root directory.
 */
export async function importAllFormats(rootDir: string): Promise<FormatImportResult[]> {
  const results = await Promise.all(
    IMPORT_FORMATS.map(async (format) => ({
      format,
      rules: await importFormat(rootDir, format),
    })),
  );
  return results;
}
