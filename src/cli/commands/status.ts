import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { readManifest } from "../../manifest/hatchJson.js";
import { hashEmittedContent } from "../../manifest/provenance.js";
import { getAdapter } from "../../adapters/index.js";
import { HATCH3R_DIR, type AdapterOutput, type HatchManifest } from "../../types.js";
import {
  extractManagedBlock,
  splitAtManagedBlock,
  isHealableManagedPrefix,
} from "../../merge/managedBlocks.js";
import {
  hasStaleDuplicateGeneratedBody,
  readPrefixFrontmatterField,
} from "../../merge/safeWrite.js";
import { filterUserFacing, readCanonicalFiles } from "../../adapters/canonical.js";
import { applyCustomization } from "../../adapters/customization.js";
import { resolveUserContentRoot } from "../../content/index.js";
import { compareVersions } from "../../version/compare.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { planPerPackageOutputs } from "../../content/monorepoEmission.js";
import { discoverUserContent } from "../../content/userContent.js";
import {
  loadSpaceMetricsFromDisk,
  summarizeSpaceMetricRecords,
} from "../../pipeline/spaceTelemetry.js";
import { buildCustomizationSummary, selectionSetFromManifest } from "../../adapters/customizationSummary.js";
import { emitJson } from "../shared/output.js";
import { beginCommand, buildJsonEnvelope } from "../shared/commandOutput.js";
import {
  assertManifest,
  MISSING_MANIFEST_MESSAGE,
  MISSING_MANIFEST_HINT,
} from "../shared/requireManifest.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  createSpinner,
  printBox,
  printNextSteps,
  info,
  isQuiet,
  label,
  verbose,
} from "../shared/ui.js";
import { readWorkspaceManifest } from "../../workspace/manifest.js";
import { detectCliTools } from "../../cliTools/detect.js";

/**
 * Wave 7 drift status — per-file comparison between on-disk adapter output
 * and freshly regenerated output (sourced from the bundled content root).
 */
export interface DriftEntry {
  path: string;
  tool: string;
  /** `in-sync` — managed block (or full content) matches regeneration.
   *  `modified` — file exists but managed block differs.
   *  `missing`  — file path absent from disk.
   *  `unexpected` — file present on disk but no longer produced by any adapter.
   */
  status: "in-sync" | "modified" | "missing" | "unexpected";
  /**
   * F2.7-F5 (D2): for `modified` entries, attributes WHY the file drifted by
   * comparing the on-disk file and a fresh regeneration against the emit-time
   * baseline hash recorded in `.hatch3r/provenance.json`:
   *   - `user-modified`     — on-disk differs from baseline; regeneration matches it (the user hand-edited; canonical content is unchanged).
   *   - `canonical-outdated`— on-disk matches baseline; regeneration differs (canonical content changed since last sync; the user did not touch the file).
   *   - `both`             — on-disk differs from baseline AND regeneration differs (the user edited and canonical also moved).
   *   - `unknown`          — no baseline recorded (file predates the provenance writer, or `sync` has not run since the upgrade).
   * Absent for non-`modified` statuses.
   */
  driftKind?: "user-modified" | "canonical-outdated" | "both" | "unknown";
  /**
   * Slash-picker fix (release/2.6.0): machine-readable sub-reason for a
   * `modified` entry whose drift the block-only comparison used to hide:
   *   - `frontmatter-stub` — the managed block matches regeneration, but the
   *     byte-0 prefix the generator emits (the picker's `name:`/`description:`
   *     stub) is missing or a stale generated stub on disk. `hatch3r sync`
   *     heals it (safeWrite stub heal); prefixes carrying genuine user content
   *     are never flagged.
   *   - `frontmatter-stub-edited` (release/2.7.0) — same stub shape, but the
   *     on-disk prefix's `model:`/`effort:` differs from the value recorded at
   *     last emit (`.hatch3r/provenance.json` `emittedModel`/`emittedEffort`):
   *     a hand edit to the hatch3r-owned prefix, which `hatch3r sync`
   *     overwrites. Durable per-agent overrides live in
   *     `.hatch3r/<type>/<id>.customize.yaml` (model:/effort:) or `hatch.json`
   *     `models.*`. Emitted only when the baseline carries the scalars;
   *     otherwise the entry stays `frontmatter-stub`.
   *   - `markers-missing` — the file exists but has no HATCH3R:BEGIN/END
   *     markers, so the regenerated block cannot be merged; `hatch3r sync`
   *     re-splices the block and preserves the existing content below it.
   *   - `stale-duplicate-body` (release/2.7.1) — a script-hosted managed
   *     output (`.js`/`.mjs`/`.cjs`) carries a stale raw copy of its
   *     hatch3r-generated script BELOW the END marker: a pre-2.6.0 sync
   *     spliced markers above the old raw script instead of replacing it, and
   *     the duplicated ESM `import` bindings break the hook (Node
   *     SyntaxError) on every invocation. The suffix is preserved user
   *     content to the merge path, so `hatch3r sync` cannot heal it — delete
   *     the file, then run `npx hatch3r sync`.
   * Absent for every other entry.
   */
  driftDetail?:
    | "frontmatter-stub"
    | "frontmatter-stub-edited"
    | "markers-missing"
    | "stale-duplicate-body";
  /**
   * release/2.7.0: human-readable detail for `frontmatter-stub-edited`
   * entries — names the edited field(s) with on-disk vs baseline values plus
   * the durable override channels (same phrasing family as the safeWrite
   * stub-heal warning). release/2.7.1: also set on `stale-duplicate-body`
   * entries, naming the corruption and the delete-then-sync remediation.
   * Rendered verbatim by {@link renderDriftLines}; absent for every other
   * entry.
   */
  driftMessage?: string;
}

/**
 * Emission-completeness gap (release/2.6.0): one canonical user-facing
 * artifact (command / agent / skill) that the named tool does NOT emit, with
 * the identified reason. Rows with an identified reason are informational —
 * they never change exit codes; a row with reason `unexplained` counts as
 * ordinary drift in `hatch3r verify` (no known gate accounts for the drop).
 */
export interface EmissionGapEntry {
  tool: string;
  contentClass: "commands" | "agents" | "skills";
  id: string;
  reason:
    | "feature-disabled"
    | "customization-disabled"
    | "cli-tools-filter"
    | "adapter-scope"
    | "unexplained";
  /** Actionable next step, rendered verbatim in human mode and carried in JSON. */
  action: string;
}

export interface DriftReport {
  entries: DriftEntry[];
  counts: { synced: number; modified: number; missing: number; unexpected: number };
  /**
   * F2.7-F5 (D2): sub-counts of the `modified` total by drift attribution.
   * The sum of these four equals `counts.modified`.
   */
  driftKindCounts: {
    userModified: number;
    canonicalOutdated: number;
    both: number;
    unknown: number;
  };
  /**
   * Emission-completeness rows (release/2.6.0): canonical user-facing
   * artifacts not emitted by a tool, each with its reason. Optional so
   * hand-built reports in tests stay valid; {@link computeAdapterDrift}
   * always sets it (empty array when complete).
   */
  emissionGaps?: EmissionGapEntry[];
}

// D12-4 (Cycle 11 Wave 2): `hashEmittedContent` moved to
// `src/manifest/provenance.ts` (alongside the `writeProvenance` writer it
// pairs with) so `init`/`update` can emit a hash-bearing provenance baseline
// without importing the whole status command graph. Re-exported here so
// existing `import { hashEmittedContent } from "./status.js"` call sites keep
// working unchanged; the drift reader below uses the same binding.
export { hashEmittedContent };

/**
 * D1-SA1.4-04 (D1, P1): direction of the version skew between the running CLI
 * and the manifest's recorded writer version.
 *   - `installed-newer` — running CLI > manifest writer (the common upgrade
 *     direction; canonical drift is expected and `sync` regenerates safely).
 *   - `installed-older` — running CLI < manifest writer (a stale global install
 *     or a teammate on a newer CLI). `sync` here regenerates from the OLDER
 *     canonical set and DOWNGRADES the on-disk output — `update` first.
 *   - `none` — versions match.
 */
export type VersionSkewDirection = "installed-newer" | "installed-older" | "none";

/**
 * D1-SA1.4-04 (D1, P1): classify the running CLI against the manifest's recorded
 * writer version. Reuses the same semver comparison `update` relies on
 * ({@link compareVersions}) so status, verify, and update agree on skew
 * direction. Shared by `status` and `verify` (verify imports it from here).
 */
export function classifyVersionSkew(
  configuredVersion: string,
  runningVersion: string,
): VersionSkewDirection {
  if (configuredVersion === runningVersion) return "none";
  return compareVersions(runningVersion, configuredVersion) < 0
    ? "installed-older"
    : "installed-newer";
}

/**
 * D1-SA1.4-04 (D1, P1): the installed-older remediation sentence, shared by
 * `status` and `verify` so both name the downgrade risk identically. Following
 * the "regenerating is safe" / `sync` hint when the installed CLI is OLDER than
 * the writer silently downgrades the outputs; this directs the operator to
 * `update` first.
 */
export function installedOlderSkewHint(
  configuredVersion: string,
  runningVersion: string,
): string {
  return (
    `Your installed hatch3r (v${runningVersion}) is older than the version that generated ` +
    `these files (v${configuredVersion}) — run \`hatch3r update\` first; ` +
    `\`hatch3r sync\` now would downgrade them.`
  );
}

/**
 * F2.7-F5 (D2): one entry of the emit-time provenance baseline read from
 * `.hatch3r/provenance.json`. `path` + `contentHash` drive hash attribution;
 * `emittedModel`/`emittedEffort` (release/2.7.0, absent on pre-2.7.0
 * manifests) drive the stub-edit attribution. The writer also stores
 * `adapter` + `sourceFiles`, unused here.
 */
interface ProvenanceBaselineEntry {
  path: string;
  contentHash?: string;
  emittedModel?: string;
  emittedEffort?: string;
}

/**
 * release/2.7.0: the per-path baseline record {@link compareAdapterOutput}
 * compares against — the emit-time block hash plus the emit-time
 * `model:`/`effort:` prefix scalars when the manifest recorded them.
 */
interface BaselineRecord {
  contentHash: string;
  emittedModel?: string;
  emittedEffort?: string;
}

/**
 * F2.7-F5 (D2): load the emit-time baseline keyed by output path (block
 * sha256 + the release/2.7.0 `emittedModel`/`emittedEffort` prefix scalars).
 * Returns an empty map when the manifest is absent, unreadable, OR written by a
 * `schemaVersion` this hatch3r does not understand (D12-SA12.2-06) so drift
 * attribution degrades to `unknown` rather than throwing or silently mis-parsing
 * a reshaped future schema — status must still render its drift summary without
 * a baseline.
 */
async function loadProvenanceBaseline(rootDir: string): Promise<Map<string, BaselineRecord>> {
  const baseline = new Map<string, BaselineRecord>();
  try {
    const raw = await readFile(join(rootDir, HATCH3R_DIR, "provenance.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number;
      outputs?: ProvenanceBaselineEntry[];
    };
    // D12-SA12.2-06 (D12, P5/P2): assert the schema this reader understands
    // before consuming `outputs`. The writer pins `schemaVersion: 1`
    // (provenance.ts `ProvenanceManifest`) and its OWN idempotency read already
    // gates on `prev.schemaVersion === 1` (provenance.ts) — the drift-baseline
    // reader must hold up its half of that contract. A future `schemaVersion`
    // (v2+) that reshapes `outputs[]` would otherwise be parsed as v1 here,
    // building a wrong (or empty) hash map and SILENTLY mis-attributing drift.
    // Degrade to the same no-baseline path a missing manifest takes (drift →
    // `unknown`) instead of mis-parsing an unrecognized shape.
    if (parsed.schemaVersion !== 1) {
      verbose(
        `status: provenance schemaVersion ${String(parsed.schemaVersion)} not understood by this ` +
          `hatch3r (expected 1); drift attribution = unknown — re-run \`hatch3r sync\` to refresh the baseline`,
      );
      return baseline;
    }
    for (const entry of parsed.outputs ?? []) {
      if (typeof entry.path === "string" && typeof entry.contentHash === "string") {
        baseline.set(entry.path, {
          contentHash: entry.contentHash,
          // release/2.7.0: carry the emit-time model/effort scalars through
          // (absent on pre-2.7.0 manifests); a non-string value from a
          // hand-edited manifest degrades to absent, which keeps the entry on
          // the pre-2.7.0 `frontmatter-stub` attribution path.
          emittedModel: typeof entry.emittedModel === "string" ? entry.emittedModel : undefined,
          emittedEffort: typeof entry.emittedEffort === "string" ? entry.emittedEffort : undefined,
        });
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
    verbose(`status: provenance baseline unavailable (${code}); drift attribution = unknown`);
  }
  return baseline;
}

/**
 * D10-17 (D10, P1): number of trailing calendar days of SPACE telemetry the
 * status reporting surface reads. The per-day JSONL filename is derived from the
 * record timestamp (`space-<YYYY-MM-DD>.jsonl`), so a `status` run the day after
 * `hatch3r init` would miss the init's `firstRunSuccessRate` if it read only
 * today. A 7-day window keeps the recent first-run signal visible without an
 * unbounded directory walk.
 */
const SPACE_TELEMETRY_WINDOW_DAYS = 7;

/**
 * D10-17 (D10, P1): structured SPACE-telemetry rollup surfaced by `status` from
 * the persisted JSONL (the cross-process read counterpart to the
 * `recordFirstRunSuccess` call wired into `init.ts`). Empty `axes` + zero
 * `recordCount` means no telemetry has been written yet.
 */
export interface SpaceTelemetrySummary {
  /** Calendar days (YYYY-MM-DD) scanned, newest first. */
  daysScanned: string[];
  /** Total metric records read across the window. */
  recordCount: number;
  /** Per-axis count + mean over the window (one row per SPACE axis). */
  axes: ReturnType<typeof summarizeSpaceMetricRecords>;
  /**
   * Mean of the `performance`-axis `firstRunSuccessRate` records (0..1), or
   * `null` when none were recorded in the window. This is the primary P1 metric.
   */
  firstRunSuccessRate: number | null;
}

/**
 * D10-17 (D10, P1): read the trailing {@link SPACE_TELEMETRY_WINDOW_DAYS}-day
 * SPACE telemetry from `.hatch3r/telemetry/space-<date>.jsonl` and roll it up.
 *
 * Delegates the across-runs day-walk to {@link loadSpaceMetricsFromDisk} (the
 * canonical multi-day reader, D10-38) so the trailing-window logic lives in one
 * place. Best-effort and side-effect-free: the loader swallows
 * missing/unreadable/corrupt files (Silent Failure Contract), so this returns a
 * zero-record summary rather than throwing when telemetry is absent.
 */
function readSpaceTelemetrySummary(rootDir: string): SpaceTelemetrySummary {
  const now = Date.now();
  const newestDay = new Date(now).toISOString().slice(0, 10);
  const oldestDay = new Date(now - (SPACE_TELEMETRY_WINDOW_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Pass an explicit [oldestDay, newestDay] range so the day list `daysScanned`
  // reports is exactly the set the loader read (one `Date.now()` reference, no
  // midnight-crossing skew between the two).
  const all = loadSpaceMetricsFromDisk(rootDir, { from: oldestDay, to: newestDay });
  const days: string[] = [];
  for (let i = 0; i < SPACE_TELEMETRY_WINDOW_DAYS; i += 1) {
    days.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  const firstRunRecords = all.filter(
    (r) => r.metricId === "firstRunSuccessRate" && r.axis === "performance",
  );
  const firstRunSuccessRate =
    firstRunRecords.length === 0
      ? null
      : firstRunRecords.reduce((sum, r) => sum + r.value, 0) / firstRunRecords.length;
  return {
    daysScanned: days,
    recordCount: all.length,
    axes: summarizeSpaceMetricRecords(all),
    firstRunSuccessRate,
  };
}

/**
 * D2-SA2.7-04 (D2, P2): mutable accumulators threaded through
 * {@link compareAdapterOutput} so the identical per-file comparison runs for
 * both root outputs and monorepo per-package copies. Objects/arrays/Sets are
 * passed by reference, so the helper mutates the same instances
 * {@link computeAdapterDrift} returns.
 */
interface DriftAccumulator {
  entries: DriftEntry[];
  counts: DriftReport["counts"];
  driftKindCounts: DriftReport["driftKindCounts"];
  seenPaths: Set<string>;
}

/**
 * D2-SA2.7-04 (D2, P2): compare ONE adapter output (root or per-package copy)
 * against its on-disk file and record the result into {@link DriftAccumulator}.
 * Extracted verbatim from the former inline root-output loop so per-package
 * monorepo copies get the SAME `modified`/`missing`/`in-sync` classification —
 * previously they were only registered in `seenPaths` (orphan-suppression) and
 * never content-compared, so a hand-edited or deleted `<package>/.cursor/...`
 * copy drifted invisibly (`verify` exited 0 while managed output had changed).
 *
 * `seenPaths.add` runs FIRST (before the read) so a per-package path is marked
 * seen even when it is missing on disk — the orphan loop then skips it (it is a
 * known managed file that is `missing`, not `unexpected`).
 *
 * driftKind attribution reads the emit-time baseline in `.hatch3r/provenance.json`.
 * The provenance writer currently records only ROOT outputs, so per-package
 * `modified` entries attribute to `unknown` (no baseline) until the writer also
 * records per-package paths — a documented interim per the finding, and the
 * same graceful degradation the baseline-absent root path already uses.
 */
async function compareAdapterOutput(
  out: AdapterOutput,
  tool: string,
  rootDir: string,
  baseline: Map<string, BaselineRecord>,
  acc: DriftAccumulator,
): Promise<void> {
  acc.seenPaths.add(out.path);
  const destPath = join(rootDir, out.path);
  try {
    const existing = await readFile(destPath, "utf-8");
    const existingBlock = extractManagedBlock(existing, out.path);
    // Prefer extracting from the regenerated content rather than the raw
    // managedContent hint: `wrapInManagedBlock` / `extractManagedBlock`
    // trim their payload, and several adapters pass an un-trimmed body
    // in `out.managedContent` for convenience. Comparing trimmed-on-disk
    // against raw-from-managedContent produced spurious "modified"
    // entries on every status call.
    const expectedBlock = extractManagedBlock(out.content, out.path) ?? out.managedContent ?? null;
    const blocksComparable = existingBlock !== null && expectedBlock !== null;
    const matches = blocksComparable
      ? existingBlock === expectedBlock.trim()
      : existing === out.content;
    // Slash-picker fix (release/2.6.0): the block-only comparison above is
    // blind to the byte-0 prefix, so a file whose generated frontmatter stub
    // (the picker's `description:` block) is missing or stale reported
    // "in-sync" while every slash-command picker showed the HATCH3R:BEGIN
    // marker. Flag it as ordinary `modified` drift when — and only when — the
    // on-disk prefix is heal-eligible per {@link isHealableManagedPrefix}
    // (empty or a pure-frontmatter stale stub); a prefix carrying genuine user
    // content is the user's and is never reported here (same rule the
    // safeWrite stub heal applies, so the report and the sync-side repair
    // agree byte-for-byte).
    let stubDrift = false;
    let onDiskStubPrefix: string | null = null;
    if (matches && blocksComparable) {
      const expectedSplit = splitAtManagedBlock(out.content, out.path);
      if (expectedSplit && expectedSplit.prefix.trim() !== "") {
        const onDiskSplit = splitAtManagedBlock(existing, out.path);
        if (
          onDiskSplit &&
          onDiskSplit.prefix !== expectedSplit.prefix &&
          isHealableManagedPrefix(onDiskSplit.prefix)
        ) {
          stubDrift = true;
          // release/2.7.0: kept for the stub-edit attribution below, which
          // parses the on-disk prefix's `model:`/`effort:` fields.
          onDiskStubPrefix = onDiskSplit.prefix;
        }
      }
    }
    // Stale-duplicate-body detection (release/2.7.1): a pre-2.6.0 sync could
    // splice the managed-block markers ABOVE an old raw hook script (e.g.
    // `.claude/hooks/pretooluse-allowlist.mjs`) instead of replacing it,
    // stranding a full stale copy of the script body BELOW the END marker —
    // duplicate ESM `import` bindings, so Node rejects the hook on every tool
    // call. That suffix is preserved user content to the block-only comparison
    // above, which therefore reported the file `in-sync` while the hook was
    // hard-broken — and `hatch3r sync` cannot heal it (the merge path never
    // rewrites content below END). Detect the stranded copy by the safeWrite
    // legacy-adoption signature, scoped to script-hosted outputs
    // (.js/.mjs/.cjs) so a hatch3r script snippet a user pasted below a
    // markdown/YAML block is never flagged for deletion. Takes precedence over
    // the block-interior classifications below: whatever the interior says,
    // plain sync leaves this file broken — the remediation is delete + re-sync.
    const staleDuplicateBody = hasStaleDuplicateGeneratedBody(existing, out.path);
    if (matches && !stubDrift && !staleDuplicateBody) {
      acc.entries.push({ path: out.path, tool, status: "in-sync" });
      acc.counts.synced++;
    } else if (staleDuplicateBody) {
      // driftKind `canonical-outdated` by construction (same reasoning as the
      // frontmatter-stub branch): the stranded suffix STARTS with recognizably
      // stale hatch3r-GENERATED output — but the signature proves only the
      // start, so the message tells the user to review the suffix for their
      // own additions before applying the delete + re-sync remediation.
      acc.entries.push({
        path: out.path,
        tool,
        status: "modified",
        driftKind: "canonical-outdated",
        driftDetail: "stale-duplicate-body",
        driftMessage:
          "stale duplicate of the generated script below the HATCH3R:END marker " +
          "(pre-2.6.0 sync splice; Node rejects the duplicated imports on every hook call) — " +
          "`hatch3r sync` preserves content below the marker and cannot heal this: " +
          "delete the file, then run `npx hatch3r sync` — the signature only proves the " +
          "content below the marker STARTS as generated output, so review it for additions " +
          "of your own before deleting",
      });
      acc.driftKindCounts.canonicalOutdated++;
      acc.counts.modified++;
    } else if (stubDrift) {
      // release/2.7.0 stub-edit attribution: the provenance baseline records
      // the emit-time `model:`/`effort:` prefix scalars (`emittedModel`/
      // `emittedEffort`), so a stub whose ON-DISK fields differ from the
      // BASELINE's is a hand edit — the pre-2.7.0 blanket `canonical-outdated`
      // mislabeled it as hatch3r's own format move while the safeWrite stub
      // heal silently discards the edit on the next sync. The provenance hash
      // machinery below cannot make this call (it hashes only the extracted
      // block, which is identical on both sides), so the fields are compared
      // directly. Same parse as the emit side (readPrefixFrontmatterField),
      // so writer and reader agree byte-for-byte.
      const baselineEntry = baseline.get(out.path);
      const editedFields: string[] = [];
      if (
        baselineEntry !== undefined &&
        onDiskStubPrefix !== null &&
        (baselineEntry.emittedModel !== undefined || baselineEntry.emittedEffort !== undefined)
      ) {
        for (const field of ["model", "effort"] as const) {
          const onDiskValue = readPrefixFrontmatterField(onDiskStubPrefix, field);
          const emittedValue =
            field === "model" ? baselineEntry.emittedModel : baselineEntry.emittedEffort;
          if (onDiskValue !== emittedValue) {
            editedFields.push(
              `${field}: ${onDiskValue ?? "(absent)"} on disk vs ${emittedValue ?? "(absent)"} at last sync`,
            );
          }
        }
      }
      if (editedFields.length > 0) {
        acc.entries.push({
          path: out.path,
          tool,
          status: "modified",
          driftKind: "user-modified",
          driftDetail: "frontmatter-stub-edited",
          driftMessage:
            `frontmatter edited on disk (${editedFields.join("; ")}) — ` +
            `\`hatch3r sync\` regenerates this hatch3r-owned prefix; durable per-agent overrides: ` +
            `\`.hatch3r/<type>/<id>.customize.yaml\` (model:/effort:) or \`hatch.json\` models.*`,
        });
        acc.driftKindCounts.userModified++;
        acc.counts.modified++;
      } else {
        // driftKind is `canonical-outdated` by construction: the managed block
        // matches regeneration byte-for-byte (no user edit inside it) and — as
        // far as the baseline can tell (absent, pre-2.7.0 without scalars, or
        // scalars matching the on-disk prefix) — the generator's output format
        // moved past the on-disk file. `hatch3r sync` heals the prefix without
        // touching any user content.
        acc.entries.push({
          path: out.path,
          tool,
          status: "modified",
          driftKind: "canonical-outdated",
          driftDetail: "frontmatter-stub",
        });
        acc.driftKindCounts.canonicalOutdated++;
        acc.counts.modified++;
      }
    } else {
      // F2.7-F5 (D2): attribute drift direction against the emit-time
      // baseline. `onDiskHash` and `regeneratedHash` are both reduced via
      // the same normalization the baseline used, so a clean comparison is
      // possible without retaining full file bodies.
      const baselineHash = baseline.get(out.path)?.contentHash;
      const onDiskHash = hashEmittedContent(existing, undefined, out.path);
      const regeneratedHash = hashEmittedContent(
        out.content,
        out.managedContent ?? undefined,
        out.path,
      );
      let driftKind: NonNullable<DriftEntry["driftKind"]>;
      if (!baselineHash) {
        driftKind = "unknown";
        acc.driftKindCounts.unknown++;
      } else {
        const userTouched = onDiskHash !== baselineHash;
        const canonicalMoved = regeneratedHash !== baselineHash;
        if (userTouched && canonicalMoved) {
          driftKind = "both";
          acc.driftKindCounts.both++;
        } else if (userTouched) {
          driftKind = "user-modified";
          acc.driftKindCounts.userModified++;
        } else if (canonicalMoved) {
          driftKind = "canonical-outdated";
          acc.driftKindCounts.canonicalOutdated++;
        } else {
          // On-disk and regeneration both match the baseline yet the
          // block comparison above flagged a difference — a normalization
          // edge (e.g. trailing-whitespace-only). Treat as unknown rather
          // than asserting a false attribution.
          driftKind = "unknown";
          acc.driftKindCounts.unknown++;
        }
      }
      // Slash-picker fix (release/2.6.0): when the on-disk file has NO
      // HATCH3R markers while regeneration expects a managed block, name that
      // condition — this is the file state the safeWrite no-marker branch
      // skips (when `appendIfNoBlock` is off) or re-splices (sync/update pass
      // `appendIfNoBlock: true`), and the generic "(drifted)" tag left the
      // operator without the marker-restoration remedy.
      const markersMissing = existingBlock === null && expectedBlock !== null;
      acc.entries.push({
        path: out.path,
        tool,
        status: "modified",
        driftKind,
        ...(markersMissing ? { driftDetail: "markers-missing" as const } : {}),
      });
      acc.counts.modified++;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    acc.entries.push({ path: out.path, tool, status: "missing" });
    acc.counts.missing++;
  }
}

/**
 * Wave 7: regenerate every adapter's output in memory (from the bundled
 * content root, no `.agents/` involvement) and compare against on-disk
 * output. The integrity-manifest fast path was removed with the integrity
 * subsystem (Wave 7); this is the only path.
 *
 * `verifyCommand` reuses this exact helper so verify+status share one
 * drift definition.
 *
 * D1-SA1.4-F8 (D2, P6) — concurrency contract: `status`/`verify` are
 * read-only and BEST-EFFORT under concurrent writes. This function reads each
 * on-disk output with `readFile` while regenerating the expected output from
 * the manifest in memory; it acquires no lock. If a concurrent `hatch3r sync`
 * is mid-write, `safeWriteFile`'s temp+rename keeps each individual file read
 * atomic (old or new bytes, never a half-written file), but the manifest the
 * concurrent sync is mutating (e.g. adding/removing a tool) and the on-disk
 * files can momentarily belong to different generations, yielding a transient
 * "modified"/"unexpected" entry. The advisory `.hatch3r/.lock` note that
 * top-level orchestrator pipelines write (see `rules/hatch3r-agent-orchestration.md`
 * -> Concurrent Invocation Handling) is a best-effort coordination point, NOT a
 * mutual-exclusion primitive (D7-27: no atomic acquire ships; the note is TOCTOU
 * by construction); a drift report produced while a writer holds that note is a
 * snapshot of an in-flight state. Re-run after the writer completes for an authoritative report; do not
 * run `status`/`verify` in parallel with `sync` and treat the result as final.
 *
 * D2-SA2.7-F8 (D2, P7) — cost note: there is no result cache. Each invocation
 * regenerates every adapter's output once (O(adapter x output-count) file
 * reads + transforms). A cross-invocation cache would not help the single-shot
 * CLI model — the process regenerates once per run and exits, so there is
 * nothing to deduplicate within a call. A persisted on-disk cache keyed on
 * (bundled-content version, manifest mtime, overrides mtime) is the only shape
 * that could help repeated shell-prompt / pre-commit use; it is deferred until
 * a profile on a representative repo confirms wall-clock > 250ms (the finding's
 * own gate), to avoid adding invalidation surface for an unmeasured win.
 */
/**
 * One canonical user-facing artifact a tool is EXPECTED to emit, plus every
 * pre-attributed drop gate the emission pipeline applies before per-file
 * output exists (release/2.6.0 emission-completeness check, S2c).
 */
export interface EmissionExpectation {
  contentClass: EmissionGapEntry["contentClass"];
  id: string;
  /** Absolute canonical source path — matched against `AdapterOutput.sourceFiles`. */
  sourcePath: string;
  /** True when `applyCustomization` honors `enabled: false` for this id. */
  customizeDisabled: boolean;
  /** Repo-relative path of the customize file that would carry the override. */
  customizePath: string;
  /** User-tier `adapters: [...]` opt-out list, when declared non-empty. */
  adapters?: string[];
  /** Skills only: dropped by the `hatch3r-cli-*` CLI-tooling pivot filter. */
  cliFiltered: boolean;
}

/**
 * Enumerate the canonical user-facing artifacts (commands / agents / skills)
 * with the same readers + filters the adapters use — `readCanonicalFiles` +
 * `filterUserFacing` for commands/agents (BaseAdapter.readUserFacingCanonicalFiles),
 * the plain read + `hatch3r-cli-*` pivot filter for skills
 * (BaseAdapter.readCliFilteredSkills) — and pre-attribute each artifact's
 * customization-skip state via a dry `applyCustomization` call (the identical
 * call the adapters make at generate time, so the verdicts agree). Reader
 * warnings are dropped here: the real generation in {@link computeAdapterDrift}
 * already surfaces them per adapter.
 */
export async function buildEmissionExpectations(
  canonicalRoot: string,
  rootDir: string,
  manifest: HatchManifest,
): Promise<EmissionExpectation[]> {
  const warningSink: string[] = [];
  const userContentRoot = resolveUserContentRoot(rootDir);
  const cliCfg = manifest.cliTools ?? { enabled: false, selected: [] as string[] };
  const cliSelected = new Set(cliCfg.selected ?? []);
  const expectations: EmissionExpectation[] = [];
  const classes: Array<{ cls: EmissionGapEntry["contentClass"]; userFacingType?: "command" | "agent" }> = [
    { cls: "commands", userFacingType: "command" },
    { cls: "agents", userFacingType: "agent" },
    { cls: "skills" },
  ];
  for (const { cls, userFacingType } of classes) {
    let files = await readCanonicalFiles(canonicalRoot, cls, warningSink, userContentRoot);
    if (userFacingType) {
      files = filterUserFacing(files, userFacingType, join(canonicalRoot, cls));
    }
    for (const f of files) {
      if (!f.sourcePath) continue;
      const cliFiltered =
        cls === "skills" &&
        f.id.startsWith("hatch3r-cli-") &&
        (!cliCfg.enabled || !cliSelected.has(f.id.replace(/^hatch3r-cli-/, "")));
      const { skip } = await applyCustomization(rootDir, f);
      expectations.push({
        contentClass: cls,
        id: f.id,
        sourcePath: f.sourcePath,
        customizeDisabled: skip,
        customizePath: `${HATCH3R_DIR}/${cls}/${f.id}.customize.yaml`,
        adapters:
          f.source === "user" && f.adapters && f.adapters.length > 0 ? f.adapters : undefined,
        cliFiltered,
      });
    }
  }
  return expectations;
}

/**
 * Compare one tool's regenerated outputs against the expectation set and
 * return a gap row for every canonical artifact the tool does not emit.
 *
 * "Emitted" means the artifact's canonical `sourcePath` appears in ANY
 * output's `sourceFiles` (per-file outputs carry exactly `[sourcePath]` per
 * the D12-1 single-source contract; aggregated outputs carry the broad read
 * set). Attributed drop gates (feature flag, customization `enabled: false`,
 * CLI-tools filter, adapter-scope opt-out) are checked FIRST — a skipped
 * artifact can still appear in an aggregate output's broad source set, so the
 * gate verdicts, not source membership, decide those rows. Only an artifact
 * that passes every known gate yet contributed to no output at all is
 * `unexplained` — that row counts as ordinary drift in `hatch3r verify`.
 */
export function assessEmissionGaps(
  tool: string,
  outputs: AdapterOutput[],
  expectations: EmissionExpectation[],
  manifest: HatchManifest,
): EmissionGapEntry[] {
  const emittedSources = new Set<string>();
  for (const out of outputs) {
    for (const src of out.sourceFiles ?? []) emittedSources.add(src);
  }
  const gaps: EmissionGapEntry[] = [];
  for (const exp of expectations) {
    if (!manifest.features[exp.contentClass]) {
      gaps.push({
        tool,
        contentClass: exp.contentClass,
        id: exp.id,
        reason: "feature-disabled",
        action: `features.${exp.contentClass} is false in ${HATCH3R_DIR}/hatch.json — set it to true and run \`hatch3r sync\` to emit this artifact.`,
      });
      continue;
    }
    if (exp.customizeDisabled) {
      gaps.push({
        tool,
        contentClass: exp.contentClass,
        id: exp.id,
        reason: "customization-disabled",
        action: `enabled: false in ${exp.customizePath} — remove the override (or set enabled: true) and run \`hatch3r sync\`.`,
      });
      continue;
    }
    if (exp.cliFiltered) {
      gaps.push({
        tool,
        contentClass: exp.contentClass,
        id: exp.id,
        reason: "cli-tools-filter",
        action: `CLI-tooling skill not selected — run \`hatch3r cli-tools\` and select \`${exp.id.replace(/^hatch3r-cli-/, "")}\` (manifest cliTools.selected), then \`hatch3r sync\`.`,
      });
      continue;
    }
    if (exp.adapters && !exp.adapters.includes(tool)) {
      gaps.push({
        tool,
        contentClass: exp.contentClass,
        id: exp.id,
        reason: "adapter-scope",
        action: `the artifact's frontmatter limits emission to adapters: [${exp.adapters.join(", ")}] — add "${tool}" to that list to emit it here.`,
      });
      continue;
    }
    if (!emittedSources.has(exp.sourcePath)) {
      gaps.push({
        tool,
        contentClass: exp.contentClass,
        id: exp.id,
        reason: "unexplained",
        action: `no drop gate accounts for this artifact — run \`hatch3r sync\` and re-check; if the gap persists, report it (generation bug).`,
      });
    }
  }
  return gaps;
}

export async function computeAdapterDrift(
  rootDir: string,
  manifest: HatchManifest,
): Promise<DriftReport> {
  const counts = { synced: 0, modified: 0, missing: 0, unexpected: 0 };
  const driftKindCounts = { userModified: 0, canonicalOutdated: 0, both: 0, unknown: 0 };
  const entries: DriftEntry[] = [];

  const canonicalContentRoot = resolveBundledContentRoot();
  // F2.7-F5 (D2): emit-time baseline (path -> block sha256 + the release/2.7.0
  // emittedModel/emittedEffort prefix scalars). Used to attribute the
  // direction of every `modified` entry below.
  const baseline = await loadProvenanceBaseline(rootDir);
  const seenPaths = new Set<string>();
  // D2-SA2.7-04 (D2, P2): single accumulator so root outputs AND monorepo
  // per-package copies flow through the identical `compareAdapterOutput` path.
  const acc: DriftAccumulator = { entries, counts, driftKindCounts, seenPaths };

  // Emission-completeness probe (release/2.6.0, S2c): built once — the
  // expectation set is tool-independent — and assessed per tool below.
  // Fail-soft: the drift comparison is this function's contract, so a probe
  // failure (unreadable overrides dir, customize parse error surfaced as a
  // throw) downgrades to "no completeness rows" with a verbose disclosure
  // instead of failing the whole status/verify run.
  const emissionGaps: EmissionGapEntry[] = [];
  let expectations: EmissionExpectation[] | null = null;
  try {
    expectations = await buildEmissionExpectations(canonicalContentRoot, rootDir, manifest);
  } catch (err) {
    verbose(
      `emission-completeness probe skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const tool of manifest.tools) {
    const adapter = getAdapter(tool);
    // Wave 7 drift parity: regeneration must use the SAME projectRoot the
    // emission used (init/sync/update pass `rootDir`). Without it, adapter
    // customization probes resolve against `process.cwd()` instead of the
    // user repo, producing spurious "modified" entries on every status call.
    const outputs = await adapter.generate(canonicalContentRoot, manifest, rootDir);
    verbose(`${tool}: ${outputs.length} output file(s) to check`);
    if (expectations) {
      emissionGaps.push(...assessEmissionGaps(tool, outputs, expectations, manifest));
    }

    for (const out of outputs) {
      await compareAdapterOutput(out, tool, rootDir, baseline, acc);
    }

    // F14.2-H1 (D14) + D2-SA2.7-04 (D2): monorepo per-package emission parity.
    // When the manifest records workspace packages AND --per-package was opted
    // in, init/sync ALSO write per-directory copies for tools whose load model
    // reads them — cursor only, per D14-6 — into every `<package>/<rel>` and
    // stamp those paths into `manifest.managedFiles`. Re-target this tool's root
    // outputs through the SAME helper init/sync use (returns [] for
    // claude/copilot) and run the IDENTICAL per-file comparison used for root
    // outputs: this both (a) registers every per-package path as seen so the
    // orphan loop below does not flag a legitimately-emitted copy as
    // `unexpected`, and (b) reports `modified`/`missing` when a copy is
    // hand-edited or deleted — the D2-SA2.7-04 fix (previously the copies were
    // seen-only and never content-compared, so they drifted invisibly).
    for (const perPkg of planPerPackageOutputs(tool, manifest.packages, outputs)) {
      await compareAdapterOutput(perPkg.output, tool, rootDir, baseline, acc);
    }
  }

  // Files emitted by init/sync directly (not by any adapter). Tracked in the
  // manifest for `clean`/`update` lifecycle parity but excluded from the
  // "unexpected" drift check so they do not generate false-positive notices.
  const NON_ADAPTER_MANAGED_FILES = new Set<string>([".worktreeinclude"]);

  // Surface files the manifest still tracks but no current adapter emits.
  // These are leftovers from a removed adapter or a renamed output path.
  for (const tracked of manifest.managedFiles ?? []) {
    if (seenPaths.has(tracked)) continue;
    if (NON_ADAPTER_MANAGED_FILES.has(tracked)) continue;
    try {
      await access(join(rootDir, tracked));
      entries.push({ path: tracked, tool: "(unowned)", status: "unexpected" });
      counts.unexpected++;
    } catch (err) {
      // Missing-and-unowned is a no-op — neither produced nor present.
      const code = (err as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
      verbose(`status: unexpected-file probe access(${tracked}) — ${code}`);
    }
  }

  return { entries, counts, driftKindCounts, emissionGaps };
}

/**
 * F2.7-F5 (D2): one-word drift-attribution tag rendered next to a `modified`
 * file so the operator can tell a hand edit (keep it) from an outdated
 * canonical block (safe to regenerate) at a glance.
 */
function driftKindTag(kind: DriftEntry["driftKind"]): string {
  switch (kind) {
    case "user-modified":
      return chalk.yellow(" (your edit)");
    case "canonical-outdated":
      return chalk.cyan(" (canonical changed)");
    case "both":
      return chalk.red(" (your edit + canonical changed)");
    case "unknown":
    default:
      return chalk.dim(" (no baseline)");
  }
}

/**
 * D12-SA12.2-F5 (D12, P1): render a "Diff summary" box from a drift report,
 * reusing the exact `+ added` / `~ modified` / `= unchanged` vocabulary that
 * `hatch3r sync --diff` already emits (sync.ts ~line 1461) so `status --diff`
 * and `verify --diff` read identically. The data is already computed in-memory
 * by {@link computeAdapterDrift}; this only re-renders the per-file status as a
 * sync-style line. `missing` maps to `+ added` (sync would create it) and
 * `unexpected` maps to a distinct `! orphan` line (sync would NOT touch it —
 * mirrors the unexpected-file handling in {@link renderDriftLines}). Shared by
 * status and verify so a future drift-category addition lands in one place.
 */
export function renderDiffSummaryLines(report: DriftReport): string[] {
  const lines: string[] = [];
  for (const entry of report.entries) {
    switch (entry.status) {
      case "in-sync":
        lines.push(`${chalk.dim("= unchanged")} ${entry.path}`);
        break;
      case "modified":
        lines.push(`${chalk.yellow("~ modified")}  ${entry.path}`);
        break;
      case "missing":
        lines.push(`${chalk.green("+ added")}     ${entry.path}`);
        break;
      case "unexpected":
        lines.push(`${chalk.red("! orphan")}    ${entry.path}`);
        break;
    }
  }
  return lines;
}

/**
 * Render the per-file drift lines for printing in status / verify output.
 *
 * D1-SA1.4-F11 (Cycle 10 Wave 4, P1): exported so `hatch3r verify --verbose`
 * reuses the identical per-tool breakdown status emits, instead of forcing the
 * operator to re-run `status` to see WHICH files drifted. Shared renderer keeps
 * a future drift-category addition landing in one place.
 */
export function renderDriftLines(report: DriftReport): string[] {
  const byTool = new Map<string, DriftEntry[]>();
  for (const entry of report.entries) {
    const arr = byTool.get(entry.tool) ?? [];
    arr.push(entry);
    byTool.set(entry.tool, arr);
  }
  const lines: string[] = [];
  for (const [tool, items] of byTool) {
    lines.push(chalk.bold(`${tool}:`));
    for (const entry of items) {
      switch (entry.status) {
        case "in-sync":
          lines.push(`  ${chalk.green("=")} ${entry.path}`);
          break;
        case "modified": {
          // Slash-picker fix (release/2.6.0): a `driftDetail` sub-reason is
          // MORE specific than the hash-attribution tag, so it replaces it —
          // the operator gets the exact remedy instead of the generic legend.
          const tag =
            entry.driftDetail === "frontmatter-stub"
              ? chalk.cyan(" (frontmatter stub missing/stale — `hatch3r sync` restores it)")
              : entry.driftDetail === "frontmatter-stub-edited"
                ? chalk.yellow(
                    ` (${
                      entry.driftMessage ??
                      "frontmatter model/effort edited on disk — `hatch3r sync` regenerates this prefix; durable overrides: `.hatch3r/<type>/<id>.customize.yaml` or `hatch.json` models.*"
                    })`,
                  )
                : entry.driftDetail === "stale-duplicate-body"
                  ? chalk.red(
                      ` (${
                        entry.driftMessage ??
                        "stale duplicate generated script below HATCH3R:END — `hatch3r sync` cannot heal this: delete the file, then run `npx hatch3r sync`"
                      })`,
                    )
                  : entry.driftDetail === "markers-missing"
                    ? chalk.yellow(
                        " (HATCH3R markers missing on disk — `hatch3r sync` re-splices the block, keeping your content below it)",
                      )
                    : driftKindTag(entry.driftKind);
          lines.push(`  ${chalk.yellow("~")} ${entry.path} ${chalk.dim("(drifted)")}${tag}`);
          break;
        }
        case "missing":
          lines.push(`  ${chalk.red("+")} ${entry.path} ${chalk.dim("(missing)")}`);
          break;
        case "unexpected":
          lines.push(`  ${chalk.red("!")} ${entry.path} ${chalk.dim("(unexpected: not produced by any current adapter)")}`);
          break;
      }
    }
  }
  return lines;
}

export async function statusCommand(opts?: {
  verbose?: boolean;
  format?: string;
  diff?: boolean;
  quiet?: boolean;
}): Promise<void> {
  // SA12.1-F-D12-M2 (D12, P1): JSON mode emits a single structured document
  // for CI consumers — see {@link buildStatusJsonOutput}. Human mode keeps
  // the legacy decorated chrome (banner, spinner, printBox panels).
  // W5: flag resolution (format/quiet/verbose + banner gating) flows through
  // the shared beginCommand chokepoint.
  const format = beginCommand(opts ?? {}, { banner: "compact" });
  const jsonMode = format === "json";
  // D1-SA1.4-10 (P5): reconciled with the sibling `verify` command — verbose
  // stderr diagnostics stay AVAILABLE under `--verbose` even in JSON mode.
  // `verbose()` writes to stderr (ui.ts), never to the stdout JSON document,
  // so the two channels cannot interleave unless the consumer merges streams
  // with `2>&1`. Both drift commands now share this one policy (previously
  // status force-disabled verbose in JSON while verify enabled it — an
  // unreconciled split across the two sibling drift commands).

  const rootDir = process.cwd();
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    // D8-SA8.1-F8.1.8 (Cycle 10 Wave 4, P1): emit the structured payload first
    // in JSON mode, then delegate the human stderr + throw to the shared
    // `assertManifest` helper so every manifest-required command prints the
    // identical missing-manifest message and CONFIG_ERROR exit code.
    if (jsonMode) {
      // D10-SA10.2-02 (D10, P1): route the legacy direct-emitJson envelope
      // through the shared builder so even the error document is
      // self-identifying (`command: "status"`) and carries the normalized
      // `outcome` alongside its domain-specific `status`.
      emitJson(
        buildJsonEnvelope(
          "status",
          {
            status: "failed",
            error: MISSING_MANIFEST_MESSAGE,
            errorCode: "CONFIG_ERROR",
            recoveryHint: MISSING_MANIFEST_HINT,
          },
          { outcome: "failed" },
        ),
      );
    }
    assertManifest(manifest, { jsonMode });
  }

  const spinner = jsonMode ? null : createSpinner("Checking adapter-output drift...");
  spinner?.start();

  verbose(`Checking ${manifest.tools.length} tool(s): ${manifest.tools.join(", ")}`);

  const report = await computeAdapterDrift(rootDir, manifest);

  // D10-17 (D10, P1): roll up the persisted SPACE telemetry (written by
  // `init.ts::recordFirstRunSuccess`) so the human box and the JSON payload both
  // surface it. Read-only, never throws.
  const spaceTelemetry = readSpaceTelemetrySummary(rootDir);

  spinner?.stop();

  // SA12.1-F-D12-M2: emit the JSON payload before any human chrome and exit
  // early so CI consumers see exactly one JSON document on stdout.
  if (jsonMode) {
    const hasDrift =
      report.counts.modified > 0 || report.counts.missing > 0 || report.counts.unexpected > 0;
    // D12-SA12.2-01 (D12, CQ2): installation-health block. Surfaces the manifest's
    // CONFIGURED hatch3r version (`manifest.hatch3rVersion`) next to the RUNNING
    // CLI version (`HATCH3R_VERSION`), the manifest schema, the tool set, and a
    // `versionSkew` flag — the single datum that explains status's most common
    // output ("canonical changed: N" is expected after a CLI upgrade). Before
    // this, the envelope carried only the RUNNING version under `hatch3rVersion`,
    // so a CI consumer could not read the configured version at all.
    const installation = {
      configuredVersion: manifest.hatch3rVersion,
      runningVersion: HATCH3R_VERSION,
      manifestVersion: manifest.version,
      tools: manifest.tools,
      versionSkew: manifest.hatch3rVersion !== HATCH3R_VERSION,
      // D1-SA1.4-04 (D1, P1): the DIRECTION of the skew (boolean `versionSkew`
      // above says only whether, not which way). A CI consumer needs the
      // direction to know that `installed-older` means `sync` would DOWNGRADE
      // the on-disk output — `update` is the correct remediation, not `sync`.
      versionSkewDirection: classifyVersionSkew(manifest.hatch3rVersion, HATCH3R_VERSION),
    };
    // D10-SA10.2-02 (D10, P1): emit through the shared envelope builder so this
    // legacy direct-emitJson document carries the self-identifying `command`
    // field and a normalized `outcome` alongside the domain-specific `status`
    // (`in-sync`/`drift`), which is preserved verbatim (no breaking rename).
    emitJson(
      buildJsonEnvelope(
        "status",
        {
          status: hasDrift ? "drift" : "in-sync",
          counts: report.counts,
          driftKindCounts: report.driftKindCounts,
          entries: report.entries,
          // Emission-completeness rows (release/2.6.0, S2c): canonical
          // user-facing artifacts no adapter output carries, each with its
          // reason + action. Informational — `status` never changes exit code.
          emissionGaps: report.emissionGaps ?? [],
          tools: manifest.tools,
          installation,
          // D10-17: SPACE developer-productivity telemetry rollup. `recordCount: 0`
          // + `firstRunSuccessRate: null` when no telemetry has been written yet.
          spaceTelemetry,
        },
        { outcome: hasDrift ? "partial" : "passed" },
      ),
    );
    return;
  }

  // Blank-line separators are chrome — suppressed under `--quiet`; the
  // drift-detail data lines below stay unconditional.
  if (!isQuiet()) console.log();

  for (const line of renderDriftLines(report)) {
    console.log(`  ${line}`);
  }
  if (!isQuiet()) console.log();

  const summaryLines = [
    `${chalk.green("=")} In sync:    ${report.counts.synced}`,
  ];
  if (report.counts.modified > 0) {
    summaryLines.push(`${chalk.yellow("~")} Drifted:    ${report.counts.modified}`);
    // F2.7-F5 (D2): break the drifted total down by attribution so the
    // operator sees, at the summary level, how many files carry their own
    // edits (keep) versus an outdated canonical block (safe to regenerate).
    const dk = report.driftKindCounts;
    if (dk.userModified > 0) summaryLines.push(`    ${chalk.yellow("•")} your edits:        ${dk.userModified}`);
    if (dk.canonicalOutdated > 0) summaryLines.push(`    ${chalk.cyan("•")} canonical changed: ${dk.canonicalOutdated}`);
    if (dk.both > 0) summaryLines.push(`    ${chalk.red("•")} edits + canonical: ${dk.both}`);
    if (dk.unknown > 0) summaryLines.push(`    ${chalk.dim("•")} no baseline:       ${dk.unknown}`);
  }
  if (report.counts.missing > 0) {
    summaryLines.push(`${chalk.red("+")} Missing:    ${report.counts.missing}`);
  }
  if (report.counts.unexpected > 0) {
    summaryLines.push(`${chalk.red("!")} Unexpected: ${report.counts.unexpected}`);
  }

  const hasDrift = report.counts.modified > 0 || report.counts.missing > 0 || report.counts.unexpected > 0;
  const style = hasDrift ? "info" as const : "success" as const;
  printBox("Status", summaryLines, style);

  // D12-SA12.2-01 (D12, CQ2): installation-health box. Renders the manifest's
  // CONFIGURED hatch3r version, the RUNNING CLI version, the manifest schema, and
  // the tool set; when the two versions differ it names the upgrade as the
  // expected CAUSE of the canonical drift reported above — the datum status
  // otherwise withheld. The manifest is already loaded (no extra disk read);
  // the skew phrasing mirrors `hatch3r update` so both commands describe skew
  // identically.
  const versionSkew = manifest.hatch3rVersion !== HATCH3R_VERSION;
  // D1-SA1.4-04 (D1, P1): classify the skew DIRECTION so the human box (and the
  // canonical-outdated hint below) distinguish a normal upgrade (installed-newer
  // → `sync` regenerates safely) from a downgrade hazard (installed-older →
  // `sync` regresses the outputs; `update` first). The predecessor's D12 box
  // only ever framed skew as an upgrade, which is wrong when the running CLI is
  // older than the manifest's writer.
  const skewDirection = classifyVersionSkew(manifest.hatch3rVersion, HATCH3R_VERSION);
  const installLines = [
    label("Configured", `hatch3r v${manifest.hatch3rVersion}`),
    label("Running CLI", `hatch3r v${HATCH3R_VERSION}`),
    label("Manifest", `schema v${manifest.version}`),
    label("Tools", manifest.tools.join(", ")),
  ];
  if (versionSkew) {
    installLines.push("");
    installLines.push(
      chalk.yellow(
        skewDirection === "installed-older"
          ? installedOlderSkewHint(manifest.hatch3rVersion, HATCH3R_VERSION)
          : `hatch3r v${manifest.hatch3rVersion} configured; CLI is v${HATCH3R_VERSION} — ` +
            `canonical drift is expected from the upgrade. Run \`hatch3r sync\` to regenerate.`,
      ),
    );
  }
  printBox("Installation", installLines, versionSkew ? "warning" : "info");

  // W5: clean-path follow-up. The drift-tailored hints below cover every
  // drifted state; this is the only guidance emitted when everything is in
  // sync. Self-gated under --quiet/json via printNextSteps.
  if (!hasDrift) {
    printNextSteps([
      "All files in sync. Run `hatch3r validate` to also check content structure.",
    ]);
  }

  // D12-SA12.2-F5 (D12, P1): `--diff` renders the same before/after summary box
  // `hatch3r sync --diff` emits, computed in-memory from the drift report (no
  // extra disk reads beyond the regeneration status already performed).
  if (opts?.diff && report.entries.length > 0) {
    const diffLines = renderDiffSummaryLines(report);
    if (diffLines.length > 0) {
      printBox("Diff summary", diffLines, "info");
      console.log();
    }
  }

  if (report.counts.modified > 0) {
    // F2.7-F5 (D2): the emit-time baseline in `.hatch3r/provenance.json` now
    // lets status attribute drift direction, so the hint is tailored per
    // sub-state instead of the prior blanket overwrite warning.
    const dk = report.driftKindCounts;
    if (dk.canonicalOutdated > 0 && dk.userModified === 0 && dk.both === 0 && dk.unknown === 0) {
      // Pure canonical drift — nothing of the user's to lose. D1-SA1.4-04: but
      // "regenerating is safe" holds ONLY when the running CLI is newer-or-equal
      // to the manifest's writer. When installed-older, `sync` regenerates from
      // the OLDER canonical set and DOWNGRADES these files — direct the operator
      // to `update` first instead of asserting sync is safe.
      if (skewDirection === "installed-older") {
        info(installedOlderSkewHint(manifest.hatch3rVersion, HATCH3R_VERSION));
      } else {
        info(
          `Run ${chalk.bold("hatch3r sync")} to update ${dk.canonicalOutdated} file(s) whose ` +
          `${chalk.cyan("canonical content changed")}. No local edits were detected, so regenerating is safe.`,
        );
      }
    } else if ((dk.userModified > 0 || dk.both > 0) && dk.canonicalOutdated === 0 && dk.unknown === 0) {
      // Only user edits — sync would overwrite them.
      info(
        `${chalk.bold("hatch3r sync overwrites the managed block.")} ` +
        `${dk.userModified + dk.both} drifted file(s) carry ${chalk.yellow("your edits")}` +
        `${dk.both > 0 ? " (some also have newer canonical content)" : ""} — ` +
        `back them up before running sync if you want to keep them.`,
      );
    } else {
      // Mixed or no-baseline — give the per-tag legend so the operator reads
      // the inline tags above and decides file-by-file.
      info(
        `Drifted files are tagged above: ` +
        `${chalk.cyan("(canonical changed)")} is safe to ${chalk.bold("hatch3r sync")}; ` +
        `${chalk.yellow("(your edit)")} / ${chalk.red("(your edit + canonical changed)")} would be ` +
        `overwritten — back up first. ${chalk.dim("(no baseline)")} means sync has not run since this file was tracked; ` +
        `run sync once to record a baseline for future attribution.`,
      );
    }
    console.log();
  }
  if (report.counts.missing > 0) {
    info(`Run ${chalk.bold("hatch3r sync")} to regenerate missing files.`);
    console.log();
  }
  if (report.counts.unexpected > 0) {
    info(`Unexpected files are tracked in the manifest but no longer produced. Run ${chalk.bold("hatch3r clean")} to remove them, or remove them manually.`);
    console.log();
  }

  // Emission-completeness one-liner (release/2.6.0, S2c): canonical artifacts
  // no adapter output carries, summarized by reason; `hatch3r verify` renders
  // the per-artifact rows. Informational — status exit semantics unchanged.
  const emissionGaps = report.emissionGaps ?? [];
  if (emissionGaps.length > 0) {
    const byReason = new Map<string, number>();
    for (const g of emissionGaps) byReason.set(g.reason, (byReason.get(g.reason) ?? 0) + 1);
    const breakdown = [...byReason.entries()]
      .map(([reason, n]) => (reason === "unexplained" ? chalk.red(`${n} ${reason}`) : `${n} ${reason}`))
      .join(", ");
    info(
      `${emissionGaps.length} canonical artifact(s) not emitted (${breakdown}). ` +
        `Run ${chalk.bold("hatch3r verify")} for per-artifact reasons and actions.`,
    );
    console.log();
  }

  // D11-SA11.2-F10 (D11, P1): scope disclosure. Drift detection compares only
  // the hatch3r-managed block (HATCH3R:BEGIN/END markers) against regeneration;
  // content you author OUTSIDE those markers is yours and is never reported
  // here. Surface this whenever drift exists so the operator does not read a
  // clean managed-block report as "the whole file is unchanged".
  if (hasDrift) {
    console.log(
      chalk.dim(
        "  Note: drift detection covers hatch3r-managed blocks only " +
        "(HATCH3R:BEGIN/END). Content outside the markers is yours — use `git diff` to inspect it.",
      ),
    );
    console.log();
  }

  // ── CLI tools (plan §4.7 status touchpoint) ────────────────
  const cliSelected = manifest.cliTools?.selected ?? [];
  if (manifest.cliTools?.enabled && cliSelected.length > 0) {
    const cliResults = await detectCliTools(cliSelected);
    const installed = cliResults.filter((r) => r.installed).length;
    const cliLines: string[] = [];
    cliLines.push(label("Installed", `${installed}/${cliResults.length}`));
    const missing = cliResults.filter((r) => !r.installed);
    if (missing.length > 0) {
      cliLines.push("");
      for (const r of missing) {
        // D21-M6 (Cycle 10): differentiate "binary missing" from "extension
        // missing" so the user reaches for the right remediation.
        if (r.extensionMissing) {
          cliLines.push(`  ${chalk.yellow("✗")} ${r.id} — extension missing: ${r.extensionMissing}`);
        } else {
          cliLines.push(`  ${chalk.yellow("✗")} ${r.id} not on PATH`);
        }
      }
      cliLines.push("");
      cliLines.push(chalk.dim(`Run \`npx hatch3r cli-tools install\` to see install commands.`));
    }
    printBox("CLI tools", cliLines, missing.length === 0 ? "success" : "info");
  }

  // ── User content (D20) ─────────────────────────────────────
  // Manifest counters are authoritative when present; otherwise fall back
  // to a live disk scan so user-authored content remains visible even when
  // a pre-D20 manifest is in play.
  let userTypes: Record<string, number> | null = null;
  let userTotal = 0;
  let userLastModified: string | null = null;
  if (manifest.userContent && manifest.userContent.count > 0) {
    userTypes = manifest.userContent.types;
    userTotal = manifest.userContent.count;
    userLastModified = manifest.userContent.lastModified;
  } else {
    try {
      const discovered = await discoverUserContent(rootDir);
      if (discovered.length > 0) {
        const types: Record<string, number> = {};
        for (const e of discovered) {
          types[e.type] = (types[e.type] ?? 0) + 1;
        }
        userTypes = types;
        userTotal = discovered.length;
      }
    } catch (err) {
      verbose(`User content discovery skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (userTypes && userTotal > 0) {
    const userLines: string[] = [];
    for (const [type, count] of Object.entries(userTypes)) {
      if (count > 0) {
        userLines.push(`${type}:`.padEnd(12) + String(count));
      }
    }
    if (userLastModified) {
      userLines.push(`${"Total:".padEnd(12)}${userTotal} item(s), last modified ${userLastModified}`);
    } else {
      userLines.push(`${"Total:".padEnd(12)}${userTotal} item(s)`);
    }
    printBox("User content", userLines, "info");
  }

  // ── Developer productivity (SPACE telemetry, D10-17) ────────
  // Surface the persisted SPACE metrics written by `init.ts` (primary metric
  // `firstRunSuccessRate`). Shown only when telemetry exists so a fresh repo
  // that has never run init keeps the status output compact. This is the
  // reporting surface that makes the SPACE pipeline a wired runtime feature
  // rather than a tested-but-uncalled library (the F10.8-1 integration gap).
  if (spaceTelemetry.recordCount > 0) {
    const spaceLines: string[] = [];
    // D10-SA10.8-04 (D10, P1): the explicit first-run line below summarizes the
    // `performance` axis, so that axis is dropped from the per-axis loop to avoid
    // rendering the same datum twice. Every OTHER fed axis (efficiency, activity)
    // still shows in the loop.
    const firstRunRendered = spaceTelemetry.firstRunSuccessRate !== null;
    if (spaceTelemetry.firstRunSuccessRate !== null) {
      const pct = Math.round(spaceTelemetry.firstRunSuccessRate * 100);
      const perfRow = spaceTelemetry.axes.find((a) => a.axis === "performance");
      const runs = perfRow?.count ?? 0;
      spaceLines.push(
        label("First-run success", `${pct}% (${runs} run${runs === 1 ? "" : "s"})`),
      );
    }
    const populatedAxes = spaceTelemetry.axes.filter(
      (a) => a.count > 0 && !(firstRunRendered && a.axis === "performance"),
    );
    for (const a of populatedAxes) {
      spaceLines.push(`  ${a.axis.padEnd(14)}${a.count} metric(s), mean ${a.mean.toFixed(2)}`);
    }
    spaceLines.push(
      chalk.dim(`  ${spaceTelemetry.recordCount} record(s) over the last ${SPACE_TELEMETRY_WINDOW_DAYS} day(s)`),
    );
    printBox("Developer productivity (SPACE)", spaceLines, "info");
  }

  // ── Customizations (SA12.3-F03) ─────────────────────────────
  // Surface the per-artifact .customize.{yaml,md} state that previously stayed
  // silent under the Silent Failure Contract. Default mode prints a one-line
  // "N active (M skipped, K failed)" row; --verbose expands to the per-artifact
  // table identical to `hatch3r explain --customizations`. Skipped when no
  // customization files exist so the status output stays compact for fresh
  // installs.
  //
  // SA12.1-F-D12-M7 (Cycle 10 Wave 3, D12, P1): default mode now ALSO lists
  // the active customizations (capped at 8 rows) so the operator sees which
  // canonical artifacts carry `.hatch3r/*.customize.*` overrides without
  // needing `--verbose` or `hatch3r explain --customizations`. The prior
  // one-line "N active" summary hid the per-artifact id list.
  try {
    const customizationSummary = await buildCustomizationSummary(
      rootDir,
      selectionSetFromManifest(manifest.content),
    );
    if (customizationSummary.entries.length > 0) {
      const c = customizationSummary.counts;
      const oneLine =
        `${chalk.bold(String(c.active))} active` +
        (c.skipped > 0 ? `, ${chalk.yellow(String(c.skipped))} skipped` : "") +
        (c.failed > 0 ? `, ${chalk.red(String(c.failed))} failed` : "") +
        // D10-29: inert overrides (deselected artifact, no adapter emits them)
        // surface in the one-liner so an override that silently does nothing is
        // not hidden behind the active count.
        (c.inert > 0 ? `, ${chalk.yellow(String(c.inert))} inert` : "");
      const customLines: string[] = [oneLine];
      if (opts?.verbose) {
        customLines.push("");
        for (const entry of customizationSummary.entries) {
          const icon =
            entry.outcome === "failed"
              ? chalk.red("✗")
              : entry.outcome === "skipped"
                ? chalk.yellow("○")
                : entry.outcome === "inert"
                  ? chalk.yellow("⊘")
                  : entry.outcome === "active"
                    ? chalk.green("✓")
                    : chalk.dim("·");
          const reason = entry.reason ? chalk.dim(` — ${entry.reason}`) : "";
          customLines.push(`  ${icon} ${entry.type}/${entry.id}${reason}`);
        }
      } else {
        // SA12.1-F-D12-M7: list non-active entries first (failed > skipped >
        // inert > active) so problems are immediately visible. Cap the active
        // rows at 8 to keep the box readable on a fresh install with many
        // overrides; the operator runs `--verbose` or
        // `hatch3r explain --customizations` for the full list.
        const FAILED_FIRST = customizationSummary.entries
          .filter((e) => e.outcome === "failed")
          .sort((a, b) => a.id.localeCompare(b.id));
        const SKIPPED_NEXT = customizationSummary.entries
          .filter((e) => e.outcome === "skipped")
          .sort((a, b) => a.id.localeCompare(b.id));
        // D10-29: inert overrides are user-actionable (the artifact is
        // deselected) — show every one, never capped, ranked above active.
        const INERT_NEXT = customizationSummary.entries
          .filter((e) => e.outcome === "inert")
          .sort((a, b) => a.id.localeCompare(b.id));
        const ACTIVE_LAST = customizationSummary.entries
          .filter((e) => e.outcome === "active")
          .sort((a, b) => a.id.localeCompare(b.id));
        const visible = [...FAILED_FIRST, ...SKIPPED_NEXT, ...INERT_NEXT, ...ACTIVE_LAST.slice(0, 8)];
        const hiddenActive = Math.max(0, ACTIVE_LAST.length - 8);
        if (visible.length > 0) {
          customLines.push("");
          for (const entry of visible) {
            const icon =
              entry.outcome === "failed"
                ? chalk.red("✗")
                : entry.outcome === "skipped"
                  ? chalk.yellow("○")
                  : entry.outcome === "inert"
                    ? chalk.yellow("⊘")
                    : chalk.green("✓");
            const reason = entry.reason ? chalk.dim(` — ${entry.reason}`) : "";
            customLines.push(`  ${icon} ${entry.type}/${entry.id}${reason}`);
          }
          if (hiddenActive > 0) {
            customLines.push(
              chalk.dim(`  … +${hiddenActive} more active (run with --verbose for the full list)`),
            );
          }
        }
        if (c.failed > 0 || c.skipped > 0 || c.inert > 0) {
          customLines.push(chalk.dim(`  Run \`hatch3r explain --customizations\` for the per-artifact table.`));
        }
      }
      printBox(
        "Customizations",
        customLines,
        c.failed > 0 ? "warning" : c.skipped > 0 || c.inert > 0 ? "info" : "success",
      );
    }
  } catch (err) {
    verbose(`Customization summary skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Workspace topology ──────────────────────────────────────
  const wsManifest = await readWorkspaceManifest(rootDir);
  if (wsManifest && wsManifest.repos.length > 0) {
    const wsLines: string[] = [];
    for (const repo of wsManifest.repos) {
      const icon = repo.sync ? chalk.green("✓") : chalk.dim("○");
      let detail: string;
      if (!repo.sync) {
        detail = chalk.dim("sync disabled");
      } else if (repo.lastSync) {
        const elapsed = Math.max(0, Date.now() - new Date(repo.lastSync).getTime());
        const hours = Math.floor(elapsed / (1000 * 60 * 60));
        const timeAgo = hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
        detail = `synced ${timeAgo}`;
      } else {
        detail = chalk.yellow("never synced");
      }
      const identity = repo.owner && repo.repo
        ? chalk.dim(`${repo.owner}/${repo.repo}`)
        : "";
      const branch = repo.defaultBranch
        ? chalk.dim(`[${repo.defaultBranch}]`)
        : "";
      const identityPart = identity || branch ? `  ${identity} ${branch}` : "";
      wsLines.push(`${icon} ${repo.name ?? repo.path}${identityPart}  ${chalk.dim(`(${detail})`)}`);
    }
    printBox(`Workspace: ${wsManifest.name} (${wsManifest.repos.length} repos)`, wsLines, "info");
  }

  // Show workspace membership info if this repo is managed by a workspace
  if (manifest.workspace) {
    const wsInfo = [
      `Managed by workspace at ${chalk.bold(manifest.workspace.rootPath)}`,
      `Last synced: ${manifest.workspace.lastSync ? new Date(manifest.workspace.lastSync).toLocaleString() : "never"}`,
    ];
    printBox("Workspace member", wsInfo, "info");
  }

}
