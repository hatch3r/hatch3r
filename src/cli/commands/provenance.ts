/**
 * SA12.1-F-D12-M11 (Cycle 10 Wave 3, D12, P1): dedicated `hatch3r provenance`
 * subcommand for inspecting `.hatch3r/provenance.json`. Before this command,
 * provenance was readable only via `hatch3r explain --source <output-path>`
 * (which required knowing the exact output path) — there was no top-level
 * read affordance for "what's recorded right now?" or "when did this
 * provenance get written?". Operators had to open the JSON file directly.
 *
 * Two modes:
 *   - `hatch3r provenance`        — print manifest header (schema, hatch3r
 *                                    version, generatedAt, lastCommand,
 *                                    lastRunId, output count) + adapter
 *                                    breakdown.
 *   - `hatch3r provenance --json` — emit the raw manifest as a single JSON
 *                                    document for CI consumers.
 *
 * Pillar service: P1 (CLI affordance for the provenance state),
 * P5 (the JSON mode lets CI gates verify provenance currency without
 * shelling out to `jq` over a hand-resolved path).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { HATCH3R_DIR, HatchError } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { printBanner, printBox, label, error as logError, info } from "../shared/ui.js";
import { emitJson, parseFormatOption, type CliOutputFormat } from "../shared/output.js";

interface ProvenanceEntry {
  path: string;
  adapter: string;
  sourceFiles: string[];
  contentHash?: string;
}

interface ProvenanceManifest {
  schemaVersion?: number;
  hatch3rVersion?: string;
  generatedAt?: string;
  lastCommand?: string;
  lastRunId?: string;
  outputs?: ProvenanceEntry[];
}

export async function provenanceCommand(opts?: { format?: string }): Promise<void> {
  const format: CliOutputFormat = parseFormatOption(opts?.format);
  const jsonMode = format === "json";
  if (!jsonMode) printBanner(true);

  const rootDir = process.cwd();
  const provenancePath = join(rootDir, HATCH3R_DIR, "provenance.json");

  let manifest: ProvenanceManifest;
  try {
    const raw = await readFile(provenancePath, "utf-8");
    manifest = JSON.parse(raw) as ProvenanceManifest;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      if (jsonMode) {
        emitJson({
          status: "absent",
          error: `No ${HATCH3R_DIR}/provenance.json found`,
          recoveryHint: "Run `hatch3r sync` to generate adapter outputs and record their canonical sources.",
          hatch3rVersion: HATCH3R_VERSION,
          timestamp: new Date().toISOString(),
        });
      } else {
        logError(`No provenance manifest found at ${HATCH3R_DIR}/provenance.json.`);
        console.log(
          chalk.dim("  Run `hatch3r sync` to generate adapter outputs and record their canonical sources."),
        );
        console.log();
      }
      throw new HatchError(
        `No ${HATCH3R_DIR}/provenance.json found`,
        undefined,
        "FS_ERROR",
        "Run `hatch3r sync` to record canonical sources, then re-run `hatch3r provenance`.",
      );
    }
    throw new HatchError(
      `Unreadable ${HATCH3R_DIR}/provenance.json: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      "FS_ERROR",
      "Re-run `hatch3r sync` to regenerate the provenance manifest; delete it manually if it remains corrupt.",
    );
  }

  if (jsonMode) {
    // Emit the manifest verbatim — CI consumers may want every field. Wrap
    // with a `status` envelope so the same payload shape (status + ...) is
    // consistent with the other JSON-mode commands.
    emitJson({
      status: (manifest.outputs?.length ?? 0) === 0 ? "empty" : "present",
      manifest,
      hatch3rVersion: HATCH3R_VERSION,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const outputs = Array.isArray(manifest.outputs) ? manifest.outputs : [];
  const headerLines = [
    label("Manifest", `${HATCH3R_DIR}/provenance.json`),
    label("Schema", String(manifest.schemaVersion ?? "(unknown)")),
    label("hatch3r", manifest.hatch3rVersion ?? "(unknown)"),
    label("Generated", manifest.generatedAt ?? "(unknown)"),
    label("Command", manifest.lastCommand ?? "(unknown)"),
    label("Run id", manifest.lastRunId ?? "(unknown)"),
    label("Outputs", String(outputs.length)),
  ];
  printBox("Provenance", headerLines, "info");

  if (outputs.length === 0) {
    info("Manifest has no recorded outputs. Run `hatch3r sync` to populate it.");
    return;
  }

  // Per-adapter rollup so the operator sees at a glance "which adapter
  // produced how many tracked outputs". A full output list is reserved for
  // `hatch3r explain --source all`.
  const perAdapter = new Map<string, number>();
  for (const out of outputs) {
    perAdapter.set(out.adapter, (perAdapter.get(out.adapter) ?? 0) + 1);
  }
  const adapterLines: string[] = [];
  for (const [adapter, count] of [...perAdapter.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    adapterLines.push(`${chalk.cyan("•")} ${adapter.padEnd(12)} ${count} output(s)`);
  }
  printBox("Per-adapter rollup", adapterLines, "info");
  info(`Run \`hatch3r explain --source <output-path>\` (or \`--source all\`) to see the per-file source list.`);
}
