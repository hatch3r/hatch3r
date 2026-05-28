import { mkdir, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { HATCH3R_DIR, sanitizeId, type CustomizationManifest } from "../types.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import type { CustomizableType } from "../models/customize.js";

/**
 * F2.3-H1 (Cycle 10 Wave 1A): Materialize Layer-4 manifest customization into
 * Layer-2 `.customize.yaml` files when YAML is absent.
 *
 * Background (verifier finding): `manifest.customization` is written from three
 * sites — `src/manifest/hatchJson.ts::createManifest`, `src/cli/commands/init.ts`
 * (preserved across `clean` → reinit at line 531), and `src/cli/commands/clean.ts`
 * (preserved via `captureConfig`). The JSDoc on
 * `src/adapters/customization.ts::applyCustomizationImpl` at L427 promises a
 * "Layer 4 (lowest) — manifest `customization` payload. Round-trips through
 * clean → reinit when project-side `.customize.yaml` files are absent." That
 * promise had no implementation: `applyCustomizationImpl` only reads Layer 2
 * (yaml) and Layer 3 (md) via `readCustomizationSnapshot`. The payload
 * round-tripped through the manifest but never re-emerged at the adapter
 * boundary.
 *
 * Implementation strategy (verifier option b — localized, no adapter-signature
 * change): on init/sync entry, before adapter emission, walk
 * `manifest.customization.{agents,skills,rules,commands}` and for each
 * `<id>` entry that has no `.hatch3r/<type>/<id>.customize.yaml` on disk,
 * materialize the entry to a `.customize.yaml` file via atomic write. YAML
 * files that already exist on disk are preserved (Layer 2 wins; this code
 * path is Layer-4 fallback).
 *
 * Result: `applyCustomizationImpl` continues to read only Layer 2 and Layer 3
 * (signature unchanged). The Layer-4 promise is satisfied because by the time
 * adapters run, every Layer-4 entry has been promoted to a Layer-2 file on
 * disk.
 *
 * Idempotent: a second call is a no-op once YAML files exist. Safe to run
 * on every init and every sync.
 *
 * @param projectRoot Absolute path to the project root (the dir containing
 *   `.hatch3r/`).
 * @param customization The `manifest.customization` payload, or undefined.
 * @returns Summary counts of materialized and preserved entries plus the list
 *   of warning strings (path-traversal rejects, unexpected I/O errors).
 */
export interface RehydrationSummary {
  materialized: string[];
  preserved: string[];
  warnings: string[];
}

const TYPE_KEYS: readonly CustomizableType[] = ["agents", "skills", "rules", "commands"] as const;

/**
 * Subset of {@link Customization} fields that round-trip through the manifest.
 * Mirrors `src/models/customize.ts::Customization` (model, scope, description,
 * enabled). Extra fields on the manifest entry are silently dropped so a
 * future schema addition does not bleed un-validated keys into the YAML file.
 */
const ROUND_TRIP_FIELDS = ["model", "scope", "description", "enabled"] as const;

function pickRoundTripFields(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ROUND_TRIP_FIELDS) {
    if (entry[key] !== undefined) {
      out[key] = entry[key];
    }
  }
  return out;
}

export async function rehydrateCustomization(
  projectRoot: string,
  customization: CustomizationManifest | undefined,
): Promise<RehydrationSummary> {
  const summary: RehydrationSummary = {
    materialized: [],
    preserved: [],
    warnings: [],
  };

  if (!customization) return summary;

  const resolvedRoot = resolve(projectRoot);

  for (const type of TYPE_KEYS) {
    const bucket = customization[type];
    if (!bucket || typeof bucket !== "object") continue;

    for (const [rawId, rawEntry] of Object.entries(bucket as Record<string, unknown>)) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;

      const safeId = sanitizeId(rawId);
      const targetPath = join(resolvedRoot, HATCH3R_DIR, type, `${safeId}.customize.yaml`);
      const resolvedTarget = resolve(targetPath);

      // Path-traversal guard: never write outside the project root. Mirrors
      // the convention used by `src/models/customize.ts::readCustomization`
      // (line 55) where a resolved path outside `resolve(projectRoot)` is
      // dropped silently. We surface a warning here because materialization
      // is a write operation — a silently-skipped manifest entry would mean
      // the Layer-4 promise is unsatisfied without any signal.
      if (!resolvedTarget.startsWith(resolvedRoot)) {
        summary.warnings.push(
          `Rehydration: refused to materialize customization for "${type}/${rawId}" — ` +
          `resolved path escapes project root. Manifest entry skipped.`,
        );
        continue;
      }

      // Layer-2 wins: if a `.customize.yaml` already exists on disk, the
      // user (or a prior rehydration) owns that file. Manifest payload is
      // Layer-4 fallback only. Use `access` rather than reading the file
      // contents — we only need existence, not parsed content.
      let yamlExists = true;
      try {
        await access(resolvedTarget);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          yamlExists = false;
        } else {
          summary.warnings.push(
            `Rehydration: failed to stat "${type}/${rawId}.customize.yaml" — ` +
            `${err instanceof Error ? err.message : String(err)}. Manifest entry skipped.`,
          );
          continue;
        }
      }

      if (yamlExists) {
        summary.preserved.push(`${type}/${safeId}`);
        continue;
      }

      const fields = pickRoundTripFields(rawEntry as Record<string, unknown>);
      if (Object.keys(fields).length === 0) {
        // No round-trippable fields. Skip — emitting an empty YAML file
        // would clutter `.hatch3r/<type>/` without changing adapter
        // behaviour.
        continue;
      }

      try {
        await mkdir(dirname(resolvedTarget), { recursive: true });
        // YAML stringify with a stable key order is provided by the `yaml`
        // library's default behaviour (insertion order from
        // pickRoundTripFields). Atomic write via `atomicWriteFile` mirrors
        // the pattern used elsewhere in the codebase for `.hatch3r/`
        // state files.
        await atomicWriteFile(resolvedTarget, yamlStringify(fields));
        summary.materialized.push(`${type}/${safeId}`);
      } catch (err) {
        summary.warnings.push(
          `Rehydration: failed to write "${type}/${rawId}.customize.yaml" — ` +
          `${err instanceof Error ? err.message : String(err)}.`,
        );
      }
    }
  }

  return summary;
}
