import { fileURLToPath } from "node:url";

/**
 * Resolves a path relative to the caller's file location.
 * Uses new URL() + fileURLToPath for cross-platform support (Windows, Vitest workers).
 */
export function resolveTestPath(importMetaUrl: string, relativePath: string): string {
  return fileURLToPath(new URL(relativePath, importMetaUrl));
}

/**
 * Central fixture factory (D3-SA3.5-F11). Re-exported here so the six
 * high-recurrence object builders are reachable from the conventional
 * shared-fixture entry point (`../fixtures.js`) that the test corpus already
 * imports `resolveTestPath` from — callers do not need to reach into the
 * deeper `helpers/configHelpers.js` path. The builders live in
 * `helpers/configHelpers.ts` alongside the pre-existing `makeManifest`
 * (single home for fixture builders; this file only re-points to it).
 */
export {
  makeManifest,
  makeContentSelection,
  makeAdapterContext,
  makePipelineContext,
  makeManifestEntry,
  makeCheckpointMeta,
  makeSnapshotMeta,
} from "./helpers/configHelpers.js";
