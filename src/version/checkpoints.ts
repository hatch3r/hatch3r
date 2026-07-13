import { compareVersions } from "./compare.js";

export interface VersionCheckpoint {
  /** Semver at which this checkpoint applies (e.g., "2.0.0"). */
  version: string;
  /**
   * Advisory action. The registry is advisory-only: `update` reads it solely to
   * surface a "run `hatch3r clean` to reinitialize" suggestion
   * (`src/cli/commands/update.ts` filters on `action === "reinit-advisory"`).
   *
   * D1-SA1.3-08: a prior `"migration"` action + `migrate?` executor field
   * advertised an auto-migration contract that was never wired — `update` never
   * invoked it, so the first migration checkpoint registered would have silently
   * no-op'd during upgrade. Auto-executed data migrations run through the
   * separate `MIGRATION_CHECKPOINTS` array in `update.ts` (condition/execute
   * closures, actually invoked by `runMigrationCheckpoints`), not this registry.
   * Add migrations there, not here.
   */
  action: "reinit-advisory";
  /** Human-readable explanation for why this checkpoint exists. */
  reason: string;
  /** Specific changes listed in the reinit advisory. */
  changes?: string[];
}

/**
 * Registry of version-gated checkpoints.
 * Populated as breaking changes are introduced in future releases.
 * Ordered by version ascending.
 */
export const VERSION_CHECKPOINTS: VersionCheckpoint[] = [];

/**
 * Return checkpoints that apply when upgrading from `fromVersion` to `toVersion`.
 * A checkpoint applies when its version is greater than `fromVersion` and less than
 * or equal to `toVersion`.
 */
export function getApplicableCheckpoints(
  fromVersion: string,
  toVersion: string,
): VersionCheckpoint[] {
  return VERSION_CHECKPOINTS.filter((cp) =>
    compareVersions(cp.version, fromVersion) > 0 &&
    compareVersions(cp.version, toVersion) <= 0,
  );
}
