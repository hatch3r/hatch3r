#!/usr/bin/env node
/**
 * scripts/validate-finding-registry.ts
 *
 * Enforces structural and Invariant 1-7 contracts on
 * `governance/audit/finding-registry.json`. The script wraps the pure
 * validators in `src/audit/registry-schema.ts` and emits exit code 0 on
 * clean / 1 on drift.
 *
 * Pillars: P2 (Scientific Quality), P5 (Governance Self-Quality).
 *
 * Modes:
 *   (default)   legacy-tolerant: pre-rigor-contract entries permitted.
 *   --strict    strict mode: full rigor contract enforced; v2 envelope required.
 *   --post-phase2  also require work_unit + wave on every targeted entry.
 *
 * Usage: `npm run audit:validate-registry [-- --strict] [-- --post-phase2]`.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRegistry,
  validateRegistry,
  RegistryParseError,
  type DriftReport,
  type ValidateOptions,
} from "../src/audit/registry-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "governance/audit/finding-registry.json");

function parseFlags(argv: ReadonlyArray<string>): ValidateOptions {
  const opts: ValidateOptions = {};
  for (const arg of argv) {
    if (arg === "--strict") opts.strict = true;
    else if (arg === "--post-phase2") opts.postPhase2 = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  let raw: unknown;
  try {
    const content = await readFile(REGISTRY_PATH, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `validate:finding-registry: failed to read or parse ${REGISTRY_PATH}: ${(err as Error).message}`,
    );
    process.exit(1);
    return;
  }

  let parsed;
  try {
    parsed = parseRegistry(raw);
  } catch (err) {
    if (err instanceof RegistryParseError) {
      // eslint-disable-next-line no-console
      console.error(`validate:finding-registry: parse error: ${err.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `validate:finding-registry: unexpected error: ${(err as Error).message}`,
      );
    }
    process.exit(1);
    return;
  }

  const drifts: DriftReport[] = validateRegistry(parsed, flags);
  const entryCount =
    parsed.kind === "v2" ? parsed.registry.entries.length : parsed.entries.length;
  const modeLabel = [
    parsed.kind === "v2" ? "v2" : "legacy-v1",
    flags.strict ? "strict" : "tolerant",
    flags.postPhase2 ? "post-phase-2" : "phase-1",
  ].join(", ");

  if (drifts.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `validate:finding-registry: ${entryCount} entries checked (${modeLabel}), 0 drift`,
    );
    return;
  }

  // Group by reason for a compact CI-readable summary.
  const byReason = new Map<string, DriftReport[]>();
  for (const d of drifts) {
    const list = byReason.get(d.reason) ?? [];
    list.push(d);
    byReason.set(d.reason, list);
  }

  // eslint-disable-next-line no-console
  console.error(
    `validate:finding-registry: ${drifts.length} drift on ${entryCount} entries (${modeLabel})`,
  );
  for (const [reason, list] of byReason) {
    // eslint-disable-next-line no-console
    console.error(`  ${reason}: ${list.length}`);
    // Show first 3 examples per reason; collapse the rest.
    const sample = list.slice(0, 3);
    for (const d of sample) {
      // eslint-disable-next-line no-console
      console.error(
        `    - ${d.finding_id}${d.detail ? `: ${d.detail}` : ""}`,
      );
    }
    if (list.length > sample.length) {
      // eslint-disable-next-line no-console
      console.error(`    ...and ${list.length - sample.length} more`);
    }
  }
  process.exit(1);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("validate:finding-registry failed:", err);
  process.exit(1);
});
