import type { HatchManifest } from "../types.js";
import { compareVersions } from "./compare.js";

export interface VersionCheckpoint {
  /** Semver at which this checkpoint applies (e.g., "2.0.0"). */
  version: string;
  /** "migration" = auto-execute during update. "reinit-advisory" = suggest hatch3r clean. */
  action: "migration" | "reinit-advisory";
  /** Human-readable explanation for why this checkpoint exists. */
  reason: string;
  /** Auto-migration function (only for action: "migration"). */
  migrate?: (manifest: HatchManifest, rootDir: string) => Promise<HatchManifest>;
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
