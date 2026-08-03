import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AdapterOutput,
  CanonicalFile,
  Features,
  GenerationMode,
  HatchManifest,
} from "../types.js";
import { HatchError } from "../types.js";
import { resolveAgentModel, resolveArtifactModel } from "../models/resolve.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
// DD-D3 (release/2.8.5): import from the domain module, not the CLI barrel —
// this was the one adapter→cli/** import (boundary Rule 1 violation).
import { generateBridgeOrchestration } from "./shared/bridgeOrchestration.js";
import {
  buildSelectionAllowlist,
  classifySelection,
  resolveUserContentRoot,
  TYPE_TO_SELECTION_KEY,
  type SelectionAllowlist,
} from "../content/index.js";
import { buildAgentsMdOutput, resolveAgentsMdOwner } from "./agentsMd.js";
import { filterUserFacing, parseFrontmatter, readCanonicalFiles, sortByPrecedence, type CanonicalType } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import {
  readMcpConfig,
  transformEnvVarSyntax,
  validateMcpEntry,
  validateMcpHttpEndpoint,
  type McpServerEntry,
} from "./mcp-utils.js";
import { scanMcpServers } from "../pipeline/mcpDescriptionScan.js";
import { readHookDefinitions } from "../hooks/index.js";
import { PLATFORM_TOOL_MARKER, toAskUserPlatformNote } from "../pipeline/adapterToolTranslator.js";
import {
  detectionContextFromManifest,
  substituteRepoTokens,
  substituteVerificationGateTokens,
} from "../pipeline/repoSubstitution.js";

/**
 * Frontmatter-safe model-value gate for the skill/command emission paths
 * (release/2.2.0). Mirrors the D11-9 structural injection guard in
 * `src/adapters/customization.ts` byte-for-byte — but that guard covers ONLY
 * the `.customize.yaml` path. Manifest-sourced values
 * (`models.{skills,commands}[id]`) reach `resolveArtifactModel` without
 * passing through `applyCustomization`, so a hand-edited manifest value
 * carrying `\n`/`: `/`[` could otherwise break out of the unquoted
 * `model: ${model}` scalar and inject a second YAML key. Gate at emission:
 * a value outside the safe set is omitted, never quoted-and-shipped.
 */
const SAFE_MODEL_RE = /^[A-Za-z0-9._/-]+$/;

export interface Adapter {
  name: string;
  warnings: string[];
  /**
   * Generate adapter output files.
   *
   * Wave 5 (D20 overrides): `userRepoRoot` is the user's repository root —
   * the directory under which `.hatch3r/overrides/` is searched for D20
   * user-authored content. Pass the same value as the working directory the
   * CLI was invoked against (init/sync/update) or the per-workspace-member
   * repo dir. When omitted/undefined, user-tier overrides are disabled
   * (canonical-only generation) — this is the legacy behaviour preserved for
   * direct test invocations that do not stage a user subtree.
   *
   * C9-H20 (D8-H8.3.1): An optional `AbortSignal` lets pipeline timeouts
   * cancel a slow adapter cooperatively. Implementations SHOULD check
   * `signal?.aborted` between long-running steps and propagate the signal
   * to inner async operations. When the signal is already aborted on
   * entry, `generate` throws `signal.reason` (or a generic
   * `AbortError`) immediately.
   */
  generate(
    canonicalRoot: string,
    manifest: HatchManifest,
    userRepoRoot?: string,
    generationMode?: GenerationMode,
    signal?: AbortSignal,
  ): Promise<AdapterOutput[]>;
  /**
   * Enumerate the output paths this adapter would produce. `userRepoRoot`
   * MUST be threaded with the same value passed to {@link Adapter.generate}
   * so the enumerated set matches the real generation set including user-tier
   * overrides (D2-SA2.1-02). Optional for backward compatibility.
   */
  getOutputPaths(
    canonicalRoot: string,
    manifest: HatchManifest,
    userRepoRoot?: string,
  ): Promise<string[]>;
}

/**
 * Convenience factory for creating an AdapterOutput with `action: "create"`.
 *
 * D12-1 (Cycle 11 Wave 2, D12, P2): the optional `sourceFiles` argument lets a
 * per-file emission path declare the SINGLE canonical file that shaped this
 * output (e.g. one rule `.mdc` derives from one `rules/*.md`). When set, it
 * survives the adapter-wide tracked-set fill in {@link BaseAdapter.generate}
 * (which only stamps the broad read set onto outputs that left the field
 * `undefined`). Aggregated outputs (CLAUDE.md, the Cursor bridge,
 * copilot-instructions.md) omit the argument and inherit the adapter-wide set,
 * which is the accurate attribution for a many-source artifact.
 */
export function output(
  path: string,
  content: string,
  managedContent?: string,
  sourceFiles?: string[],
): AdapterOutput {
  return { path, content, managedContent, action: "create", sourceFiles };
}

export interface AdapterContext {
  /**
   * Wave 4: the bundled canonical-content root resolved via
   * {@link resolveBundledContentRoot}. Adapters read canonical agents/skills/
   * rules/commands/hooks/prompts/mcp from `${canonicalRoot}/{dir}/`. The
   * legacy `.agents/` materialisation in the user repo no longer exists.
   */
  canonicalRoot: string;
  /**
   * Wave 5: the user's repository root. D20 user-authored content lives
   * under `${userRepoRoot}/.hatch3r/overrides/{type}/...`. When `undefined`,
   * user-tier overrides are disabled (canonical-only generation). The
   * BaseAdapter helpers automatically resolve this to a `userContentRoot`
   * via {@link resolveUserContentRoot} when reading canonical files.
   *
   * This replaces the brittle `process.cwd()` fallback used in Wave 4 — every
   * CLI call site (init/sync/update + workspace sync) now plumbs this
   * explicitly. {@link AdapterContext.projectRoot} continues to point at the
   * same directory so `applyCustomization` / customization probes keep
   * resolving against the user's working tree.
   */
  userRepoRoot?: string;
  manifest: HatchManifest;
  features: Features;
  projectRoot: string;
  /** Generation verbosity mode. "minimal" strips comments, descriptions, and reduces formatting. */
  generationMode: GenerationMode;
  /**
   * C9-H20 (D8-H8.3.1): Optional abort signal threaded from the pipeline
   * timeout (see `src/pipeline/phaseTimeout.ts` and
   * `src/pipeline/adapterTimeout.ts`). Adapters performing long-running
   * work SHOULD check `signal?.aborted` at loop boundaries and call
   * {@link BaseAdapter.throwIfAborted} (or equivalent) to terminate
   * cleanly when the pipeline cancels them.
   */
  signal?: AbortSignal;
}

export interface ModelFormat {
  text: string;
  after?: boolean;
}

export type CleanMcpEntry = Omit<McpServerEntry, "_disabled" | "_description">;

/**
 * D2-SA2.1-F4 (P5): the canonical companion-content subdirectories every
 * adapter mirrors under its native path via {@link BaseAdapter.processCompanionSubdir}.
 * Hoisted to a single `as const` tuple so each adapter's `companionMappings`
 * array references these members by name — a typo (e.g. `"agents/share"`) is a
 * compile error instead of a silent zero-output emission, and the canonical
 * set lives in one place (D02-SA2.1 checklist: walks `agents/modes/`,
 * `agents/shared/`, `commands/board/`, `commands/rework/`, `commands/shared/`,
 * `checks/`).
 *
 * D2-SA2.1-01 (Cycle 12 Wave 2, P5): `commands/shared/` — home of the
 * orchestration-frame companion added Cycle 11 — was omitted from this tuple for
 * ~2 weeks after it landed, so every emitted orchestrator command referenced
 * `commands/shared/orchestration-frame.md` while no adapter shipped it (the
 * TypeScript `CompanionSubdir` union catches typos but not omissions). The
 * completeness invariant in `src/__tests__/adapters/base.test.ts`
 * ("KNOWN_COMPANION_SUBDIRS completeness invariant") walks the on-disk
 * `agents/`+`commands/` subdir set (mirroring the dynamic copy path in
 * `src/content/index.ts`) and fails if this tuple omits a discovered member,
 * so the next companion class cannot be added to the tree without wiring.
 */
export const KNOWN_COMPANION_SUBDIRS = [
  "agents/modes",
  "agents/shared",
  "commands/board",
  "commands/rework",
  "commands/shared",
  "checks",
] as const;

/** Union of the canonical companion-subdir literals (see {@link KNOWN_COMPANION_SUBDIRS}). */
export type CompanionSubdir = (typeof KNOWN_COMPANION_SUBDIRS)[number];

// D10-SA10.6-01: `buildSelectionAllowlist`, the `SelectionAllowlist` type, and
// the shared verdict predicate `classifySelection` all live together in
// `src/content/index.ts` (CQ8 single home) — import them from there.

function defaultModelFormat(model: string): ModelFormat {
  return { text: `**Recommended model:** \`${model}\`` };
}

/**
 * Render {@link value} as a YAML double-quoted scalar safe for a single-line
 * frontmatter field (e.g. `description:`).
 *
 * Command and skill descriptions routinely contain `: ` and `--` sequences
 * (e.g. "Pick up epics/issues from the project board: dependency-aware
 * selection") that make an unquoted YAML plain scalar ambiguous or invalid.
 * When the `description:` line fails to parse, the slash-command / skill picker
 * in Claude Code / Cursor / Copilot falls back to showing the `HATCH3R:BEGIN`
 * managed-block marker as the description. Double-quoting removes that hazard.
 * Used by {@link processCommandsWithFm} and
 * {@link processSkillsWithFmCliFiltered}.
 *
 * Transform: collapse runs of CR/LF to a single space (a frontmatter scalar is
 * one line), then escape backslashes FIRST and double-quotes second — order
 * matters, because escaping `"` first would have its inserted `\` doubled by
 * the backslash pass — then wrap in double quotes.
 */
function toYamlDoubleQuotedScalar(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ");
  const escaped = singleLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Extract the canonical `argument-hint` frontmatter value from a command's raw
 * file content, or `undefined` when absent/blank.
 *
 * The slash-command picker (Claude Code) renders `argument-hint:` as the
 * expected-argument affordance (D5-33). The field is NOT on
 * {@link CanonicalMetadata} — `parseFrontmatter`'s allowlist omits it — so the
 * pre-fix `processCommandsRaw` only carried it through by emitting the whole
 * raw frontmatter inside the managed block (below the byte-0 marker, where the
 * picker could not read it). {@link processCommandsWithFm} re-parses it here
 * and re-emits it in the byte-0 stub, the command analogue of how the skills
 * helper preserves `allowed-tools`. Re-parsing (rather than threading a typed
 * field) keeps the change inside the adapter layer.
 *
 * No try/catch (CONSTITUTION §2 P5 / `silent-failure/no-silent-catch`): every
 * `cmd` reaching {@link processCommandsWithFm} was already parsed by the
 * canonical reader ({@link readCanonicalFiles} runs `parseFrontmatter` → the
 * same `yaml` parser and drops a file with invalid frontmatter before it
 * becomes a `CanonicalFile`), so `parseYaml` on the same byte-0 `---…---` block
 * cannot throw here. A regex miss (no frontmatter block) or a non-string/absent
 * value returns `undefined`; if unvalidated content ever reached this helper, a
 * YAML error would propagate loudly rather than be silently swallowed.
 */
export function extractArgumentHint(rawContent: string): string | undefined {
  // D2-SA2.1-06 (D2, P1): tolerate CRLF. The canonical reader's FRONTMATTER_REGEX
  // (canonical.ts) already admits `\r?\n`, so a CRLF user-override command (a
  // Windows `core.autocrlf=true` working tree) is a valid CanonicalFile — but an
  // LF-only regex here would MISS its frontmatter and silently drop the picker's
  // argument-hint affordance (D5-33) for exactly those files. Match `\r?\n` and
  // strip CR from the captured block before parseYaml so the scalar value never
  // carries a trailing `\r`.
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const parsed = parseYaml(match[1].replace(/\r/g, "")) as Record<string, unknown> | null;
  const hint = parsed?.["argument-hint"];
  return typeof hint === "string" && hint.trim().length > 0 ? hint : undefined;
}

export abstract class BaseAdapter implements Adapter {
  abstract readonly name: string;
  /**
   * Per-invocation diagnostics surfaced from canonical reads, customization
   * application, MCP loading, and adapter-internal validation.
   *
   * C9-M12 (D2 Medium, Cycle 10 Wave 3 rollover): every `generate()` invocation
   * is the OWNER of this array between the entry `this.warnings = []` reset
   * and its return — callers MUST NOT share a single adapter instance across
   * concurrent `generate()` calls. `getAdapter()` in `src/adapters/index.ts`
   * returns a fresh instance per call to enforce this at the construction
   * site. Helpers that mutate `this.warnings` (e.g. `inlineRules`,
   * `processSkillsRaw`, `loadAndAssembleMcp`) and external utilities that
   * receive `this.warnings` as an out-parameter (`readCanonicalFiles`,
   * `applyCustomization`, `readHookDefinitions`, `readMcpConfig`) all rely on
   * this single-owner contract.
   */
  warnings: string[] = [];

  /**
   * Generate adapter output files from canonical content.
   *
   * Output structure contract -- each AdapterOutput returned MUST satisfy:
   * - `path` must be a valid relative path (no absolute paths, no leading `/`)
   * - `path` must not traverse upward (no `..` segments)
   * - `content` must be non-empty (zero-length content indicates a generation bug)
   * - `managedContent`, if present, must be a substring of `content` (it represents
   *   the hatch3r-managed portion within the full file content)
   *
   * Adapters that violate these invariants will produce broken output files or
   * corrupt user content during the merge phase.
   */
  async generate(
    canonicalRoot: string,
    manifest: HatchManifest,
    userRepoRoot?: string,
    generationMode: GenerationMode = "standard",
    signal?: AbortSignal,
  ): Promise<AdapterOutput[]> {
    this.warnings = [];
    this._cachedOutputPaths = null; // Invalidate path cache on re-generation
    // C8-D12-M3: Reset per-invocation provenance tracker before doGenerate.
    // Helpers on this class (inlineRules, inlineAgents, processSkills*,
    // processCommandsRaw) push every canonical file they read into the set;
    // after doGenerate returns, the set is the closed list of canonical
    // files this adapter consumed in the current run.
    this._trackedSourceFiles = new Set<string>();
    // D10-SA10.6-01: reset the lazily-computed selection allowlist so a
    // re-generation against a different manifest recomputes it (and the
    // empty-union warning fires at most once per generate()).
    this._selectionAllowlist = undefined;

    // C9-H20 (D8-H8.3.1): Honour an already-aborted signal before doing any
    // work. Subsequent abort checks are performed inside helpers
    // (`throwIfAborted` is exposed for adapter implementations to call
    // between long-running steps).
    BaseAdapter.throwIfSignalAborted(signal);

    // Wave 5: prefer the explicit `userRepoRoot` plumbed by CLI commands; fall
    // back to `process.cwd()` only when the caller did not supply one (direct
    // test invocations that do not stage user-tier overrides). Customization
    // probes (`applyCustomization` -> `.hatch3r/customize.yaml`) continue to
    // resolve against this same directory.
    const projectRoot = userRepoRoot ?? process.cwd();

    const outputs = await this.doGenerate({
      canonicalRoot,
      userRepoRoot,
      manifest,
      features: manifest.features,
      projectRoot,
      generationMode,
      signal,
    });

    // Re-check after doGenerate completes — the signal may have fired
    // mid-generation but the implementation chose to swallow it instead of
    // throwing. Surface the abort here so callers see consistent behaviour.
    BaseAdapter.throwIfSignalAborted(signal);

    // D9-SA9.5-05 (Cycle 12 CL-2 U6): opt-in root AGENTS.md interop surface.
    // Appended from this shared wrapper — never from any doGenerate — so the
    // output class needs zero per-adapter code (Decision-12: an output
    // surface, not an adapter) and flows through the invariant enforcement
    // below like every doGenerate output. Owner election keeps the emission
    // single-writer across a multi-tool sync: resolveAgentsMdOwner returns a
    // tool name only when `manifest.agentsMd?.enabled === true` (default OFF —
    // absence leaves every adapter's output set byte-identical), and only the
    // elected adapter appends the file, so the sync-side cross-adapter
    // path-collision warning never fires for AGENTS.md.
    if (resolveAgentsMdOwner(manifest) === this.name) {
      outputs.push(buildAgentsMdOutput(manifest));
    }

    // C9-H4 (D2-SA2.1-01): Output-invariant enforcement.
    //
    // Path-traversal is a P6 (Security & Trust) violation — a sync that
    // would write outside the project root MUST fail loudly. We throw a
    // HatchError so the CLI surfaces a non-zero exit code instead of
    // pushing a warning and silently writing the corrupt path.
    //
    // Empty content and managedContent-not-substring are P5 (Silent
    // Failure Contract) violations: both indicate a generation bug that
    // would otherwise produce a broken output file or corrupt user
    // content during merge. We drop the offending output (rather than
    // throwing) so a single bad output in a multi-file adapter does not
    // poison the rest of the sync, but we still surface a warning so the
    // operator sees the failure.
    const traversalOutputs = outputs.filter(
      (o) =>
        o.path.startsWith("/") ||
        // D2-SA2.1-07 (D2, P6): the POSIX `startsWith("/")` check misses
        // Windows-absolute forms (`C:\evil`, `C:/evil`). `join(rootDir, rel)` in
        // the write path CONTAINS rather than resets a drive-letter segment, so
        // today the gap is contract-incompleteness — the thrown error promises
        // "no absolute paths" universally — not live traversal. Reuse the
        // drive-letter pattern `filterUserFacing` already applies in
        // canonical.ts so both surfaces model the Windows absolute shape.
        /^[A-Za-z]:[\\/]/.test(o.path) ||
        o.path.includes(".."),
    );
    if (traversalOutputs.length > 0) {
      const paths = traversalOutputs.map((o) => `"${o.path}"`).join(", ");
      throw new HatchError(
        `Adapter "${this.name}" produced output path(s) ${paths} that are absolute or contain ".." traversal segments. ` +
          `Output paths must be relative to the project root with no upward traversal. ` +
          `This is a generation bug — fix the adapter's doGenerate implementation.`,
        undefined,
        "ADAPTER_ERROR",
        `This is a hatch3r adapter bug, not a repo-config issue — upgrade to the latest hatch3r (\`npm install -g hatch3r@latest\`) and re-run; if it persists, file an issue at https://github.com/hatch3r/hatch3r/issues citing adapter "${this.name}" and path(s) ${paths}.`,
      );
    }

    const filteredOutputs: AdapterOutput[] = [];
    for (const out of outputs) {
      if (!out.content) {
        this.warnings.push(
          `[${this.name}] Empty content for output "${out.path}" — output dropped (possible generation bug)`,
        );
        continue;
      }
      // The managed-block wrappers (`wrapManagedFor` / `wrapInManagedBlock`)
      // trim the inner content before wrapping with markers (see
      // src/merge/managedBlocks.ts::wrapWithMarkers), so a legitimate adapter
      // pattern is `output(path, wrapManagedFor(path, x), x)` where x has
      // leading/trailing whitespace. We honour that by comparing the trimmed
      // projection — only a genuine substring mismatch (e.g. managedContent
      // contains characters the wrapper could not have produced) drops the
      // output.
      if (
        out.managedContent &&
        !out.content.includes(out.managedContent.trim())
      ) {
        this.warnings.push(
          `[${this.name}] managedContent is not a substring of content for "${out.path}" — output dropped (would corrupt managed-block merge)`,
        );
        continue;
      }
      filteredOutputs.push(out);
    }

    // D11-3 (Cycle 11 Wave 2, D11, P5): intra-adapter output-path collision
    // guard. The sync-side collision check (`sync.ts`) only fires across
    // adapters (`existingOwner !== tool`); two outputs from the SAME adapter at
    // one path slipped through as silent last-writer-wins. Copilot's
    // regular-agent path (`.github/agents/{id}.agent.md`) and github-agent path
    // share that template, so an id shared between `agents/` and
    // `github-agents/` would emit twice to one path with no warning — the merge
    // phase would then write one body over the other unattributed (Silent
    // Failure Contract violation). Centralised here so all 3 adapters inherit
    // the guard. We keep the LAST occurrence (the on-disk last-writer-wins
    // reality) but surface a warning per colliding path so the clash is
    // audit-visible. Deterministic: `dedupedByPath` preserves first-seen order
    // and overwrites the retained entry in place on a later collision.
    const dedupedByPath: AdapterOutput[] = [];
    const pathIndex = new Map<string, number>();
    for (const out of filteredOutputs) {
      const existingIdx = pathIndex.get(out.path);
      if (existingIdx === undefined) {
        pathIndex.set(out.path, dedupedByPath.length);
        dedupedByPath.push(out);
      } else {
        this.warnings.push(
          `[${this.name}] Output path collision: "${out.path}" emitted more than once by this adapter — ` +
            `keeping the last and dropping the earlier copy (would otherwise be a silent last-writer-wins overwrite at the merge phase).`,
        );
        dedupedByPath[existingIdx] = out;
      }
    }

    // Reassign so the rest of this method works against the surviving set.
    // Local mutation only — adapters do not retain references to the
    // returned array between calls.
    outputs.length = 0;
    outputs.push(...dedupedByPath);

    // C8-D12-M3: Attach per-output source provenance. Adapters that already
    // set `sourceFiles` explicitly (e.g. a single-canonical-file output path
    // that wants a tighter attribution than the adapter-wide tracked set)
    // retain their value — we only fill the default tracked set for outputs
    // that left the field unset. The tracked list is deterministic (sorted)
    // so downstream diffs over `.provenance.json` stay stable across runs.
    //
    // D12-1 (Cycle 11 Wave 2, D12, P2): per-FILE emission paths (one rule
    // `.mdc`, one agent `.md`, one skill `SKILL.md`, one command, one
    // companion file) now self-declare `sourceFiles: [thisFile.sourcePath]`
    // via the {@link output} factory's 4th argument, so this broad fill no
    // longer over-attributes them with the whole read set. Only AGGREGATED
    // outputs (CLAUDE.md, the Cursor bridge, copilot-instructions.md — each
    // assembled from many canonical files) leave the field unset and inherit
    // the adapter-wide `trackedList`, which is the accurate many-source
    // attribution for those artifacts.
    //
    // SA12.1-F-D12-M5 (Cycle 10 Wave 3, D12, P1): when an adapter produced
    // outputs without using `readTrackedCanonicalFiles` AND without setting
    // `sourceFiles` explicitly, the historical behavior left every output
    // with `sourceFiles: undefined`, which surfaced as an empty array in
    // `.hatch3r/provenance.json` — indistinguishable from "this output
    // legitimately has no canonical inputs" (e.g. `mcp.json` assembled from
    // user config). Emit a single per-adapter warning so the gap is visible
    // at sync time; consumers of `explain --source` see the same `[]` but
    // can correlate with the warn() output to identify a tracking bug.
    const trackedList = [...this._trackedSourceFiles].sort();
    if (trackedList.length > 0) {
      for (const out of outputs) {
        if (out.sourceFiles === undefined) {
          out.sourceFiles = trackedList;
        }
      }
    } else {
      // No canonical-file tracking happened. Warn ONLY when at least one
      // output had no explicit `sourceFiles` AND the adapter actually
      // produces canonical-file-shaped output (i.e. has any outputs). A
      // pure-config adapter that legitimately has no canonical inputs
      // suppresses the warning by setting `sourceFiles: []` on each output.
      const untracked = outputs.filter((o) => o.sourceFiles === undefined);
      if (untracked.length > 0) {
        this.warnings.push(
          `[${this.name}] ${untracked.length} output(s) emitted without canonical-source ` +
          `tracking — use readTrackedCanonicalFiles (or set sourceFiles: [] for ` +
          `config-only outputs) to populate .hatch3r/provenance.json. ` +
          `Affected: ${untracked.slice(0, 3).map((o) => o.path).join(", ")}` +
          `${untracked.length > 3 ? ` … (${untracked.length} total)` : ""}`,
        );
        // Default to `[]` so downstream consumers see the empty array
        // explicitly rather than `undefined`.
        for (const out of untracked) out.sourceFiles = [];
      }
    }

    return outputs;
  }

  /**
   * Returns the list of output file paths this adapter would produce.
   *
   * The default implementation calls `generate()` and extracts paths, which
   * is correct but incurs the cost of full content generation. Subclasses
   * that can determine paths without rendering content (e.g. adapters with
   * fixed output paths or paths derived only from canonical file IDs)
   * should override this with a lightweight implementation.
   *
   * D2-SA2.1-02 (Cycle 12 Wave 3, D2, P2): `userRepoRoot` is threaded to
   * `generate()` with the same value the caller uses for real generation. The
   * path set is a function of the user-tier overrides layered in from
   * `${userRepoRoot}/.hatch3r/overrides/`, so an enumeration that omits it
   * returns a strict subset (canonical-only). `update.ts`'s D1-4 rollback
   * pre-enumeration uses this method to record the tombstone set; without the
   * parameter a newly-created user-override output escaped tombstoning and
   * survived a rollback. Omitting the arg keeps the legacy canonical-only
   * enumeration (test invocations that stage no user subtree).
   *
   * Memoises the last computed result keyed on the full argument tuple
   * (`canonicalRoot`, `manifest` by reference, `userRepoRoot`). D3-SA3.1-03
   * (Cycle 12 Wave 3, D3, CQ5): the prior cache was argument-insensitive, so a
   * second call with a different `userRepoRoot`/`canonicalRoot`/`manifest`
   * returned the first call's paths. A direct `generate()` call also
   * invalidates the memo (the reset at the top of `generate`).
   */
  private _cachedOutputPaths:
    | { canonicalRoot: string; manifest: HatchManifest; userRepoRoot: string | undefined; paths: string[] }
    | null = null;
  async getOutputPaths(
    canonicalRoot: string,
    manifest: HatchManifest,
    userRepoRoot?: string,
  ): Promise<string[]> {
    const cached = this._cachedOutputPaths;
    if (
      cached &&
      cached.canonicalRoot === canonicalRoot &&
      cached.manifest === manifest &&
      cached.userRepoRoot === userRepoRoot
    ) {
      return cached.paths;
    }
    const outputs = await this.generate(canonicalRoot, manifest, userRepoRoot);
    const paths = outputs.map((o) => o.path);
    this._cachedOutputPaths = { canonicalRoot, manifest, userRepoRoot, paths };
    return paths;
  }

  /**
   * C9-H20 (D8-H8.3.1): Throw if the provided AbortSignal has been aborted.
   *
   * Adapters with custom loops that perform per-file I/O (e.g. claude.ts's
   * agent emission, cursor.ts's per-rule .mdc emission) should call this
   * between iterations so a pipeline timeout cancels the work cooperatively
   * rather than waiting for the current file batch to complete. Implemented
   * as a static so subclasses can call it on `BaseAdapter.throwIfSignalAborted(ctx.signal)`
   * without needing to thread a per-instance method into helper functions.
   *
   * The thrown error matches Node's AbortController convention: when
   * `signal.reason` is set, it is rethrown verbatim; otherwise a generic
   * `AbortError` (DOMException-style) is thrown. Callers can detect both
   * by checking `err.name === "AbortError"`.
   */
  static throwIfSignalAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    if (reason !== undefined) {
      const err = new Error(typeof reason === "string" ? reason : "Adapter generation aborted");
      err.name = "AbortError";
      throw err;
    }
    const err = new Error("Adapter generation aborted");
    err.name = "AbortError";
    throw err;
  }

  /**
   * Instance shorthand for {@link BaseAdapter.throwIfSignalAborted}. Lets
   * subclass methods write `this.throwIfAborted(ctx)` between long-running
   * loop iterations.
   */
  protected throwIfAborted(ctx: AdapterContext): void {
    BaseAdapter.throwIfSignalAborted(ctx.signal);
  }

  /**
   * C8-D12-M3: Per-invocation set of canonical-file `sourcePath`s consumed
   * during the current `generate()` call. Reset at the top of `generate()`
   * and populated by {@link readTrackedCanonicalFiles} — the wrapper used
   * by every in-class helper that reads canonical content. The set is
   * exposed to outputs via {@link AdapterOutput.sourceFiles} so operators
   * can trace which canonical file(s) shaped each generated artifact.
   *
   * Initialised as empty so a subclass that calls `readTrackedCanonicalFiles`
   * outside of `generate()` still has a defined collection to push into.
   */
  private _trackedSourceFiles: Set<string> = new Set<string>();

  /**
   * D20 user-content authoring: filter user-tier files by their optional
   * `adapters: [...]` frontmatter against the current adapter's `name`.
   *
   * Rules (matches the adapter-scope semantics declared in the user-content
   * authoring plan):
   * - Canonical files (`source` undefined or `"canonical"`) are always
   *   emitted regardless of any `adapters` value — `adapters` is a
   *   user-tier-only signal.
   * - User files with no `adapters` list (omitted or empty) emit on every
   *   adapter — full parity is the default.
   * - User files with a non-empty `adapters` list emit only on adapters
   *   whose `name` is in the list. Adapter ids must match the values in
   *   `Tool` (`src/types.ts`).
   *
   * Centralised so both the tracked and user-facing read wrappers below
   * apply identical filter rules, keeping the user-tier scope contract in
   * one place.
   */
  private filterByAdapterScope(files: CanonicalFile[]): CanonicalFile[] {
    return files.filter((f) => {
      if (f.source !== "user") return true;
      const adapters = f.adapters;
      if (!adapters || adapters.length === 0) return true;
      return adapters.includes(this.name);
    });
  }

  /**
   * D10-SA10.6-01: lazily-computed per-generate selection allowlist.
   * `undefined` = not computed yet this generate(); `null` = computed and
   * disabled (absent content / empty union — see
   * {@link buildSelectionAllowlist}).
   */
  private _selectionAllowlist: SelectionAllowlist | null | undefined;

  /**
   * Compute (once per `generate()`) the selection allowlist for the current
   * manifest, warning exactly once when a PRESENT `manifest.content` resolves
   * to an empty-union selection and the filter therefore disables fail-open.
   * An ABSENT `manifest.content` disables silently — that is the recorded
   * "no selection" state of legacy manifests, not a malformed one.
   */
  private selectionAllowlistFor(ctx: AdapterContext): SelectionAllowlist | null {
    if (this._selectionAllowlist !== undefined) return this._selectionAllowlist;
    const content = ctx.manifest.content;
    const allow: SelectionAllowlist | null = buildSelectionAllowlist(content);
    if (allow === null && content !== undefined) {
      this.warnings.push(
        `[${this.name}] manifest.content is present but its items selection is empty — ` +
          `selection filtering is disabled for this run and every canonical artifact emits ` +
          `(fail-open; expected for legacy/workspace manifests whose custom selection resolved zero ids). ` +
          `Run \`hatch3r config\` to record a real selection.`,
      );
    }
    this._selectionAllowlist = allow;
    return allow;
  }

  /**
   * D10-SA10.6-01: drop canonical files absent from the manifest's tracked
   * content selection (`manifest.content.items`), making a `hatch3r config`
   * removal a genuine emission-dropping removal instead of manifest-only
   * bookkeeping. Applied by {@link readTrackedCanonicalFiles} /
   * {@link readUserFacingCanonicalFiles} after {@link filterByAdapterScope}
   * and BEFORE provenance tracking, so `sourceFiles` stays aligned with the
   * actually-emitted set (same ordering rationale as the D20 adapter-scope
   * filter).
   *
   * Filter rules live in the single shared verdict predicate
   * `classifySelection` (src/content/index.ts, review fix F1) — consumed here
   * AND by the status/verify emission-expectation mirror so the two surfaces
   * cannot drift. Summary: `allow === null` ⇒ disabled; user-tier artifacts,
   * CLI-tooling skills (`hatch3r-cli-*` — governed by `manifest.cliTools` via
   * {@link readCliFilteredSkills}, never double-gated by `content.items`),
   * classes without a {@link TYPE_TO_SELECTION_KEY} row, and classes whose
   * key is absent from the allowlist all keep; `protected: true` always
   * emits, with a repair warning here when the id is missing from the
   * selection (`resolveSelection` admits protected items unconditionally, so
   * that state can only arise from a hand-edited or corrupted manifest). NO
   * blanket floor-tag bypass: floor items are legitimately context-filtered
   * at selection time (e.g. projectType at Stage 4), so the recorded
   * selection is trusted for them.
   *
   * Bypass classes that never route through this filter (by construction):
   * companion subdirectories + `checks/` ({@link processCompanionSubdir}),
   * MCP servers ({@link readFilteredMcp} — own `manifest.mcp.servers`
   * selection), hook definitions ({@link readHooks} → `readHookDefinitions` —
   * see the hooks note on {@link buildSelectionAllowlist}), and every
   * config-only output (settings/hooks.json, mcp.json).
   */
  private filterBySelection(
    files: CanonicalFile[],
    allow: SelectionAllowlist | null,
  ): CanonicalFile[] {
    if (allow === null) return files;
    return files.filter((f) => {
      const verdict = classifySelection(f, allow);
      if (verdict === "keep-protected-missing") {
        this.warnings.push(
          `[${this.name}] protected artifact "${f.id}" is missing from manifest.content.items.${TYPE_TO_SELECTION_KEY[f.type]} — ` +
            `emitted anyway (protected artifacts always ship). resolveSelection records protected ids ` +
            `unconditionally, so this indicates a hand-edited manifest; run \`hatch3r config\` to repair the selection.`,
        );
        return true;
      }
      // sec-2.8.6-b2-p4: a DROPPED artifact carrying `floor:security` is
      // still dropped — the recorded selection is trusted, no emission
      // bypass — but the drop is escalated to a warning so a hand-edited
      // selection cannot silently shed security-floor guidance
      // (resolveSelection admits floor content by default). Mirrors the
      // status-side `not-selected-floor-security` attribution.
      if (verdict === "drop" && (f.tags ?? []).includes("floor:security")) {
        this.warnings.push(
          `[${this.name}] security-floor artifact "${f.id}" (floor:security) is missing from ` +
            `manifest.content.items.${TYPE_TO_SELECTION_KEY[f.type]} — dropped per the recorded selection. ` +
            `resolveSelection admits security-floor content by default, so this indicates a hand-edited ` +
            `selection; run \`hatch3r config\` to re-add it, then \`hatch3r sync\`.`,
        );
        return false;
      }
      return verdict === "keep";
    });
  }

  /**
   * C8-D12-M3: Canonical-file read wrapper that records provenance.
   *
   * Delegates to {@link readCanonicalFiles} and additionally pushes every
   * returned file's `sourcePath` into the per-invocation tracker. Helpers
   * on this class use this wrapper so every adapter automatically gets
   * source-file provenance without individual adapters needing to change.
   *
   * D20: After the read, files are filtered through
   * {@link filterByAdapterScope} so user-tier artifacts that opt out of
   * this adapter (via `adapters: [...]` frontmatter) are dropped before
   * provenance tracking — keeping `sourceFiles` aligned with the actually
   * emitted set.
   *
   * D10-SA10.6-01: canonical files then pass through
   * {@link filterBySelection} so the manifest's tracked content selection
   * (`manifest.content.items`) acts as an emission allowlist. The signature
   * takes the {@link AdapterContext} first (release/2.8.6) because the
   * selection filter needs the manifest, not just the two root paths.
   *
   * External callers (outside BaseAdapter) should prefer calling
   * `readCanonicalFiles` directly; this wrapper is the BaseAdapter-internal
   * integration point for {@link AdapterOutput.sourceFiles} population.
   */
  protected async readTrackedCanonicalFiles(
    ctx: AdapterContext,
    type: CanonicalType,
  ): Promise<CanonicalFile[]> {
    // Wave 5: when an explicit user-repo root is plumbed, resolve to the
    // `.hatch3r/overrides/` subtree so D20 user-authored artifacts layer on
    // top of bundled canonical content. Undefined user root => canonical-only.
    const userContentRoot = ctx.userRepoRoot ? resolveUserContentRoot(ctx.userRepoRoot) : undefined;
    const files = await readCanonicalFiles(ctx.canonicalRoot, type, this.warnings, userContentRoot);
    const filtered = this.filterBySelection(
      this.filterByAdapterScope(files),
      this.selectionAllowlistFor(ctx),
    );
    for (const f of filtered) {
      // `sourcePath` is an absolute filesystem path to the canonical file;
      // guarded against the rare test-fixture case where a synthesised
      // CanonicalFile may have an empty path.
      if (f.sourcePath) this._trackedSourceFiles.add(f.sourcePath);
    }
    return filtered;
  }

  /**
   * Read canonical commands or agents and filter to only those that should
   * appear in a tool's user-facing command/agent picker. Wraps
   * {@link readCanonicalFiles} + {@link filterUserFacing} and applies
   * provenance tracking only to the surviving files, so filtered-out
   * companion content does not pollute the adapter's source-file manifest.
   *
   * Filter rules are documented on {@link filterUserFacing}: files in
   * support subdirectories (`commands/board/`, `agents/modes/`, etc.) and
   * top-level files with a non-primary frontmatter `type:` (e.g.
   * `shared-context`, `reference`, `mode`) are excluded.
   *
   * D20: User-tier artifacts additionally pass through
   * {@link filterByAdapterScope} so a user agent declaring
   * `adapters: [claude]` is dropped from every adapter except `claude`.
   *
   * D10-SA10.6-01: like {@link readTrackedCanonicalFiles}, the surviving
   * canonical files pass through {@link filterBySelection} (ctx-first
   * signature for the same manifest-access reason).
   */
  protected async readUserFacingCanonicalFiles(
    ctx: AdapterContext,
    type: "commands" | "agents",
  ): Promise<CanonicalFile[]> {
    // Wave 5: same `.hatch3r/overrides/` lookup as readTrackedCanonicalFiles.
    const userContentRoot = ctx.userRepoRoot ? resolveUserContentRoot(ctx.userRepoRoot) : undefined;
    const files = await readCanonicalFiles(ctx.canonicalRoot, type, this.warnings, userContentRoot);
    const expectedType = type === "commands" ? "command" : "agent";
    // `filterUserFacing` is keyed off `${canonicalRoot}/${type}` as the base
    // directory. User-tier files (read via an explicit userContentRoot, Wave
    // 5+) resolve to a relative path beginning with `..` so the helper's
    // safe-default keep branch lets them through unchanged — only canonical
    // companion subdirectories like `commands/board/` and `agents/modes/`
    // are filtered out. User files then run through {@link filterByAdapterScope}
    // for the `adapters: [...]` opt-out.
    const userFacing = filterUserFacing(files, expectedType, join(ctx.canonicalRoot, type));
    const filtered = this.filterBySelection(
      this.filterByAdapterScope(userFacing),
      this.selectionAllowlistFor(ctx),
    );
    for (const f of filtered) {
      if (f.sourcePath) this._trackedSourceFiles.add(f.sourcePath);
    }
    return filtered;
  }

  protected abstract doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]>;

  /**
   * Returns the raw bridge orchestration content (no surrounding headers).
   * Use this when the adapter needs custom formatting around the bridge content.
   */
  protected async bridgeOrchestration(ctx: AdapterContext): Promise<string> {
    const orchestration = await generateBridgeOrchestration(
      ctx.canonicalRoot,
      ctx.manifest.content?.preset,
      this.name,
      // D1-30: thread the manifest handoffs flag so `false` drops the
      // `.hatch3r/handoffs/` segment from the Canonical Structure line.
      ctx.features.handoffs,
    );
    return this.isMinimal(ctx) ? this.stripMinimal(orchestration) : orchestration;
  }

  /**
   * Read canonical rules and format them as inline markdown sections.
   *
   * D6-SA6.1-F6.1.8 (P4): no current adapter calls this helper — the 3
   * supported adapters (claude, cursor, copilot) each emit rules via their own
   * per-rule loop. It is retained as a BaseAdapter utility exercised by the
   * adapter test suite (`src/__tests__/adapters/base.test.ts` uses it to probe
   * sourceFiles provenance, AbortSignal threading, and customization). The 7
   * single-file inline adapters that originally consumed it (gemini, aider,
   * amp, goose, zed, antigravity, amazonq) were removed in the 1.9.0 adapter
   * cut (CONSTITUTION §6 Decision 12); removal of the helper itself is deferred
   * because it would require rewriting those tests.
   */
  protected async inlineRules(ctx: AdapterContext): Promise<string[]> {
    if (!ctx.features.rules) return [];
    const lines: string[] = [];
    // Sort rules by precedence (critical -> high -> normal -> low, id
    // lexicographic tie-break) before concatenation so a single-file inline
    // emission would carry rule sections in deterministic priority order.
    // Rules without a `precedence` field fall back to "normal" rank, so
    // legacy fixtures keep their alphabetic order.
    const rules = sortByPrecedence(
      await this.readTrackedCanonicalFiles(ctx, "rules"),
    );
    const minimal = this.isMinimal(ctx);
    for (const rule of rules) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      const desc = overrides.description ?? rule.description;
      if (minimal) {
        lines.push(`## ${rule.id}`, "", this.stripMinimal(content), "");
      } else {
        lines.push(`## ${rule.id}`, "", desc, "", content, "");
      }
    }
    return lines;
  }

  /**
   * Read canonical agents and format them as inline markdown sections with
   * optional model annotations.
   *
   * D6-SA6.1-F6.1.8 (P4): like {@link inlineRules}, no current adapter calls
   * this helper — claude/cursor/copilot each emit agents via their own loop.
   * Retained as a BaseAdapter utility exercised by the adapter test suite;
   * removal is deferred because the tests in
   * `src/__tests__/adapters/base.test.ts` use it as a provenance/abort probe.
   */
  protected async inlineAgents(
    ctx: AdapterContext,
    formatModel?: (model: string) => ModelFormat,
  ): Promise<string[]> {
    if (!ctx.features.agents) return [];
    const lines: string[] = [];
    const agents = await this.readUserFacingCanonicalFiles(ctx, "agents");
    const minimal = this.isMinimal(ctx);
    for (const agent of agents) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
      const desc = overrides.description ?? agent.description;
      const fmt = model ? (formatModel ?? defaultModelFormat)(model) : undefined;
      lines.push(`## Agent: ${agent.id}`);
      if (fmt && !fmt.after) lines.push(fmt.text);
      if (minimal) {
        lines.push("", this.stripMinimal(content));
      } else {
        lines.push("", desc, "", content);
      }
      if (fmt?.after) lines.push("", fmt.text);
      lines.push("");
    }
    return lines;
  }

  /**
   * D12-1 (Cycle 11 Wave 2, D12, P2): the single-canonical-source attribution
   * for a per-file output. Each skill/command/agent/rule file emits exactly
   * one adapter output derived from exactly one canonical file, so its
   * `sourceFiles` must be `[thisFile.sourcePath]` — not the adapter-wide read
   * set. Returns `undefined` for the rare synthesised fixture whose
   * `sourcePath` is empty, so the output falls back to the broad tracked set
   * rather than carrying a `[""]` row.
   */
  private singleSource(file: Pick<CanonicalFile, "sourcePath">): string[] | undefined {
    return file.sourcePath ? [file.sourcePath] : undefined;
  }

  /**
   * Process skills and output each as a raw managed-block file at the path
   * returned by `pathFn`.
   *
   * D2-SA2.1-04 (P4): no current adapter calls this helper — claude/cursor/
   * copilot each emit skills via the CLI-filtered {@link processSkillsWithFmCliFiltered}
   * twin (Wave 3 swap). Retained as a BaseAdapter utility exercised by
   * `src/__tests__/adapters/base.test.ts` (per-output emission probe); removal
   * is deferred because it would require rewriting those tests. WARNING for a
   * future adapter author: this raw twin does NOT apply the CLI-tooling filter,
   * picker-safe frontmatter quoting, `allowed-tools`, or `model:` emission that
   * {@link processSkillsWithFmCliFiltered} carries — reach for the live twin, not
   * this one, for a real skill-emission pipeline.
   */
  protected async processSkillsRaw(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.skills) return [];
    const results: AdapterOutput[] = [];
    const skills = await this.readTrackedCanonicalFiles(ctx, "skills");
    for (const skill of skills) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      results.push(output(pathFn(skill.id), wrapManagedFor(pathFn(skill.id), content), content, this.singleSource(skill)));
    }
    return results;
  }

  /**
   * Read canonical skills with the CLI-tooling pivot filter applied.
   *
   * Filter rules (plan §4.6):
   *  - Skills whose id does NOT start with `hatch3r-cli-` pass through
   *    unchanged (every adapter still emits the non-CLI skill catalogue).
   *  - When `manifest.cliTools` is absent or `enabled: false`, drop every
   *    `hatch3r-cli-*` skill (master switch off).
   *  - When `cliTools.enabled` is true, keep only those whose suffix
   *    (after stripping `hatch3r-cli-`) appears in `cliTools.selected`.
   *
   * Wave 3 swaps each adapter's frontmatter skill emission to the
   * CLI-filtered {@link processSkillsWithFmCliFiltered} variant below; the
   * filter helper is exposed protected so adapters with custom skill
   * pipelines can reuse it directly.
   */
  protected async readCliFilteredSkills(ctx: AdapterContext): Promise<CanonicalFile[]> {
    const all = await this.readTrackedCanonicalFiles(ctx, "skills");
    const cliCfg = ctx.manifest.cliTools ?? { enabled: false, selected: [] as string[] };
    const selected = new Set(cliCfg.selected ?? []);
    return all.filter((skill) => {
      if (!skill.id.startsWith("hatch3r-cli-")) return true;
      if (!cliCfg.enabled) return false;
      const cliId = skill.id.replace(/^hatch3r-cli-/, "");
      return selected.has(cliId);
    });
  }

  /**
   * Emit each CLI-filtered skill as a managed-block file prefixed with a
   * `name: + description:` YAML stub, honouring `manifest.cliTools.selected`
   * via {@link readCliFilteredSkills}.
   *
   * D9-H-6 (D9, P1): when `opts.emitAllowedTools` is true AND the canonical
   * skill declares a non-empty `allowed_tools` list, an `allowed-tools:` YAML
   * array line is appended to the frontmatter stub. This pre-approves those
   * tools on the GitHub Copilot Skills surface so the runtime skips the
   * per-invocation tool-confirmation prompt
   * (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills,
   * accessed 2026-05-26). The flag is opt-in because the Cursor adapter
   * shares this helper and its SKILL.md format does not document
   * `allowed-tools` — emitting it there would be inert cruft. When the flag
   * is false or the skill declares no tools, the stub is the historical
   * `name: + description:` shape and output is byte-identical to the prior
   * behavior.
   *
   * release/2.2.0 — `opts.emitModel`: per-adapter opt-in for a `model:` line
   * in the frontmatter stub, resolved via `resolveArtifactModel("skills",
   * ...)` (customize > `models.skills[id]` > skill frontmatter; NO
   * `models.default` fallback — that stays agents-only). The predicate
   * receives the alias-expanded value and returns whether the target
   * platform's skill surface recognizes it (e.g.
   * `isClaudeRecognizableModel`). Same opt-in rationale as
   * `emitAllowedTools`: Cursor SKILL.md documents no `model` field and
   * Copilot SKILL.md model support is unverified, so an adapter that does not
   * opt in stays byte-identical. `inherit` is never emitted — an omitted
   * field IS the inherit semantic on every skill surface.
   */
  protected async processSkillsWithFmCliFiltered(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
    opts?: { emitAllowedTools?: boolean; emitModel?: (model: string) => boolean },
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.skills) return [];
    const results: AdapterOutput[] = [];
    const skills = await this.readCliFilteredSkills(ctx);
    for (const skill of skills) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      const desc = overrides.description ?? skill.description;
      // Double-quote the description for the same picker-safety reason the
      // command helper does (see {@link processCommandsWithFm}): a `: `- or
      // `--`-bearing description breaks the byte-0 plain scalar otherwise.
      const fmLines = [`name: ${skill.id}`, `description: ${toYamlDoubleQuotedScalar(desc)}`];
      // release/2.2.0: per-skill `model:` emission (see the emitModel JSDoc
      // note above). SAFE_MODEL_RE re-gates here because the manifest map
      // path bypasses the customize-layer injection guard.
      const model = resolveArtifactModel("skills", skill.id, skill.model, ctx.manifest, overrides);
      if (model && model !== "inherit" && SAFE_MODEL_RE.test(model) && opts?.emitModel?.(model)) {
        fmLines.push(`model: ${model}`);
      }
      // D9-H-6: append the Copilot `allowed-tools` pre-approval array when
      // the adapter opts in and the skill declares tools. Each entry is
      // JSON-quoted so binaries containing characters that would otherwise
      // need YAML escaping (none today, but future-proof) stay valid.
      if (opts?.emitAllowedTools && skill.allowedTools && skill.allowedTools.length > 0) {
        fmLines.push(`allowed-tools: [${skill.allowedTools.map((t) => `"${t}"`).join(", ")}]`);
      }
      const fm = `---\n${fmLines.join("\n")}\n---`;
      results.push(output(pathFn(skill.id), `${fm}\n\n${wrapManagedFor(pathFn(skill.id), content)}`, content, this.singleSource(skill)));
    }
    return results;
  }

  /**
   * Process commands and output each as a raw managed-block file at the path
   * returned by `pathFn`.
   *
   * D2-SA2.1-04 (P4): no current adapter calls this helper — claude/cursor/
   * copilot each emit commands via the frontmatter-prepending
   * {@link processCommandsWithFm} twin (D5-33 swap). Retained as a BaseAdapter
   * utility exercised by `src/__tests__/adapters/base.test.ts` and
   * `commandArgumentHint.test.ts`; removal is deferred because it would require
   * rewriting those tests. WARNING for a future adapter author: this raw twin
   * emits NO byte-0 `name:`/`description:`/`argument-hint:`/`model:` frontmatter
   * stub, so the slash-command picker would show the `HATCH3R:BEGIN` marker
   * instead of the real description — reach for {@link processCommandsWithFm}, not
   * this one, for a real command-emission pipeline.
   */
  protected async processCommandsRaw(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.commands) return [];
    const results: AdapterOutput[] = [];
    // Filter out companion/reference content (shared-context, subdirectory
    // workflow steps like commands/board/pickup-*) so they do not appear
    // as user-invocable entries in the tool's command picker.
    const commands = await this.readUserFacingCanonicalFiles(ctx, "commands");
    for (const cmd of commands) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, cmd);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      results.push(output(pathFn(cmd.id), wrapManagedFor(pathFn(cmd.id), content), content, this.singleSource(cmd)));
    }
    return results;
  }

  /**
   * Process commands and output each with YAML frontmatter (`name`,
   * `description`) prepended before the managed block, at the path returned by
   * `pathFn`.
   *
   * Twin of {@link processCommandsRaw} (same user-facing canonical read,
   * customization, token substitution, feature gate, and warnings handling) —
   * and the command analogue of {@link processSkillsWithFmCliFiltered} — but emits a
   * `---\nname:\ndescription:\n---` stub at byte 0 so the slash-command picker
   * in Claude Code / Cursor / Copilot shows the real description instead of the
   * `HATCH3R:BEGIN` managed-block marker (the picker reads `description:` at
   * byte 0). It uses {@link applyCustomization} (frontmatter-stripped body),
   * not {@link applyCustomizationRaw} (full file), so the canonical frontmatter
   * is not re-emitted inside the managed block. The description (and any
   * `argument-hint`) is rendered as a YAML double-quoted scalar via
   * {@link toYamlDoubleQuotedScalar} because command descriptions routinely
   * carry `: ` / `--`, and `argument-hint` values such as `[service-name]`
   * would otherwise parse as a YAML flow sequence, either of which breaks an
   * unquoted plain scalar.
   *
   * The canonical `argument-hint` field (when present) is re-emitted in the
   * stub so the picker's argument affordance survives at byte 0 (D5-33) — the
   * pre-fix `processCommandsRaw` carried it only below the marker where the
   * picker could not read it. Other canonical command frontmatter (governance
   * metadata like `orchestrator`/`agentPipeline`/`triage_tiers`) is
   * intentionally NOT hoisted: it is hatch3r-authoring data with no runtime or
   * picker consumer.
   *
   * release/2.2.0 — `opts.emitModel`: per-adapter opt-in for a `model:` line
   * (after `argument-hint`), resolved via `resolveArtifactModel("commands",
   * ...)` (customize > `models.commands[id]` > command frontmatter; NO
   * `models.default` fallback — a command-level model switches the whole
   * conversation model, so it must be an explicit per-id choice). The
   * predicate gates to platform-recognizable values
   * (`isClaudeRecognizableModel` / `isCopilotRecognizableModel`); Cursor
   * passes no opts — its `.cursor/commands/*.md` surface documents no `model`
   * field — and stays byte-identical. `inherit` is never emitted (omitted
   * field == inherit).
   */
  protected async processCommandsWithFm(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
    opts?: { emitModel?: (model: string) => boolean },
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.commands) return [];
    const results: AdapterOutput[] = [];
    const commands = await this.readUserFacingCanonicalFiles(ctx, "commands");
    for (const cmd of commands) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, cmd);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      const desc = overrides.description ?? cmd.description;
      const fmLines = [`name: ${cmd.id}`, `description: ${toYamlDoubleQuotedScalar(desc)}`];
      const argumentHint = extractArgumentHint(cmd.rawContent);
      if (argumentHint) fmLines.push(`argument-hint: ${toYamlDoubleQuotedScalar(argumentHint)}`);
      // release/2.2.0: per-command `model:` emission (see the emitModel JSDoc
      // note above). SAFE_MODEL_RE re-gates here because the manifest map
      // path bypasses the customize-layer injection guard.
      const model = resolveArtifactModel("commands", cmd.id, cmd.model, ctx.manifest, overrides);
      if (model && model !== "inherit" && SAFE_MODEL_RE.test(model) && opts?.emitModel?.(model)) {
        fmLines.push(`model: ${model}`);
      }
      const fm = `---\n${fmLines.join("\n")}\n---`;
      results.push(output(pathFn(cmd.id), `${fm}\n\n${wrapManagedFor(pathFn(cmd.id), content)}`, content, this.singleSource(cmd)));
    }
    return results;
  }

  /**
   * Emit companion/reference content from a canonical subdirectory.
   *
   * Companion content lives under support subdirectories of the canonical
   * tree (`agents/modes/`, `agents/shared/`, `commands/board/`,
   * `commands/rework/`, `checks/`) and is referenced by primary
   * artifacts via path strings such as
   * `agents/shared/quality-charter.md` or
   * `agents/modes/architecture.md`. Pre-1.9.0 these files were
   * materialised in the user's `.agents/` mirror; the bundled-content
   * migration (commit e4e5126) removed that mirror without re-emitting
   * the companion subtrees, so canonical references stopped resolving in
   * the user repo. This helper closes that gap by emitting each `.md`
   * file as a managed-block output under the per-adapter native path
   * supplied by `pathFn`.
   *
   * Notes on the design choice:
   * - Path references inside companion bodies are NOT rewritten — the
   *   runtime agent uses Grep/Glob on the filename, which finds the file
   *   wherever it lives. Existing canonical bodies already rely on this
   *   pattern when referencing rules (e.g. `rules/hatch3r-X.md` resolves
   *   on disk to `.claude/rules/{NN}-hatch3r-X.md`).
   * - `substituteCanonicalContent` is applied so the PLATFORM-TOOL marker
   *   in `agents/shared/user-question-protocol.md` is replaced with the
   *   per-adapter platform note, matching the substitution that
   *   `inlineAgents` / `inlineRules` perform on primary artifacts.
   * - Outputs are tracked as managed blocks so orphan cleanup (in
   *   `src/cli/commands/sync.ts`) reclaims them if a future canonical
   *   tree drops the file.
   * - ENOENT on `canonicalSubdir` is silently treated as an empty
   *   directory so adapters can call this helper for every subdir
   *   without each one needing to probe existence first.
   *
   * @param canonicalSubdir A member of {@link KNOWN_COMPANION_SUBDIRS} — the
   *   parameter is typed to that union (D2-SA2.1-F4) so a typo in any adapter's
   *   `companionMappings` array fails the TypeScript compile rather than
   *   silently emitting zero outputs for the mistyped subdir.
   * @param pathFn Mapping from companion file basename (e.g. `"architecture.md"`)
   *   to the adapter-native output path.
   * @param opts `emitFmStub: true` prepends the same byte-0 YAML stub the
   *   with-fm command/skill helpers emit (`name:` = basename without
   *   extension; `description:` = the companion's frontmatter description
   *   when present, double-quoted) before the managed block. Opt-in per call
   *   site because companion subdirs are NOT uniformly picker surfaces:
   *   `commands/board|revision|shared` land under each tool's command
   *   directory, where slash-command pickers read `description:` at byte 0 —
   *   without the stub they render the HATCH3R:BEGIN marker. `agents/modes`
   *   and `agents/shared` land under `.claude/agents/`-style directories that
   *   Claude Code parses as agent definitions — a `name:`/`description:` stub
   *   there would register reference material as invocable agents, so those
   *   call sites (and `checks/`, which no picker reads) stay raw (default
   *   false, byte-identical to the pre-2.6.0 output).
   */
  protected async processCompanionSubdir(
    ctx: AdapterContext,
    canonicalSubdir: CompanionSubdir,
    pathFn: (filename: string) => string,
    opts?: { emitFmStub?: boolean },
  ): Promise<AdapterOutput[]> {
    const fullDir = join(ctx.canonicalRoot, canonicalSubdir);
    let entries: { name: string; isFile: () => boolean }[];
    try {
      entries = await readdir(fullDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const results: AdapterOutput[] = [];
    const minimal = this.isMinimal(ctx);
    const sorted = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sorted) {
      this.throwIfAborted(ctx);
      const src = join(fullDir, entry.name);
      let raw: string;
      try {
        raw = await readFile(src, "utf-8");
      } catch (err) {
        this.warnings.push(
          `[${this.name}] failed to read companion file ${canonicalSubdir}/${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // D2-8 (Cycle 11 Wave 3, D2, P4/P5): a companion subdir is filtered by
      // `.md` extension alone, so a self-excluded authoring guide such as
      // `checks/README.md` (frontmatter `type: documentation`) was emitted as
      // a real artifact to `.claude/checks/`, `.cursor/checks/`,
      // `.github/checks/`. Parse the frontmatter and skip non-content types so
      // the emission set mirrors the canonical-content reader's documentation
      // exclusion. README.md is also hard-excluded by name to cover an
      // untyped/frontmatter-less README dropped into a companion dir.
      const { rawType, metadata } = parseFrontmatter(raw);
      if (rawType === "documentation" || entry.name.toLowerCase() === "readme.md") {
        continue;
      }

      const substituted = this.substituteCanonicalContent(raw, ctx);
      const body = minimal ? this.stripMinimal(substituted) : substituted;
      this._trackedSourceFiles.add(src);
      const outPath = pathFn(entry.name);
      let fullContent = wrapManagedFor(outPath, body);
      // Slash-picker fix (release/2.6.0, opt-in — see the `opts` JSDoc):
      // command-companion files previously had NO byte-0 stub by construction,
      // so pickers showed the HATCH3R:BEGIN marker as their description. The
      // stub mirrors processCommandsWithFm's shape; `description:` is omitted
      // when the companion frontmatter carries none (empty-string default).
      if (opts?.emitFmStub) {
        const fmLines = [`name: ${entry.name.replace(/\.md$/i, "")}`];
        if (metadata.description) {
          fmLines.push(`description: ${toYamlDoubleQuotedScalar(metadata.description)}`);
        }
        fullContent = `---\n${fmLines.join("\n")}\n---\n\n${fullContent}`;
      }
      // D12-1: a companion file is single-source — its only canonical input is
      // `src` (the absolute path just read), so attribute it directly rather
      // than letting the adapter-wide fill stamp the broad read set.
      results.push(output(outPath, fullContent, body, [src]));
    }
    return results;
  }

  /**
   * Read MCP server config and filter to only the servers selected in the
   * manifest.
   *
   * Three drop gates run per entry, each `continue`-skipping the entry so it
   * is never emitted into an adapter artifact:
   *   1. `_disabled` — operator-disabled in canonical `mcp.json`.
   *   2. not selected — absent from `ctx.manifest.mcp.servers`.
   *   3. **HTTP endpoint policy (F15.5-H2 / C9-M34, Pillar P6)** — an HTTP
   *      transport (`url` set, `command` unset) that is neither SHA-256
   *      pinned (`_pinned_sha256`) nor explicitly opted out (`_trust_bypass:
   *      true`) is REFUSED at emission, not merely warned. Previously
   *      {@link validateMcpEntry} only pushed a warning while the unpinned
   *      entry still shipped; this gate makes the refusal effective so a
   *      generated client config never points at an unverifiable remote
   *      endpoint. The drop is auditable: the policy reason is appended to
   *      `this.warnings` (Silent Failure Contract, CONSTITUTION §2 P5) so the
   *      operator sees which server was withheld and why.
   *
   * D11-16 (Cycle 11 Wave 3, D11, P5/SA11.3-F4): warn-only per-entry
   * validation ({@link validateMcpEntry} + {@link scanMcpServers}) is SCOPED to
   * the post-selection survivors. {@link readMcpConfig} is called with
   * `validateEntries: false` so the bundle-wide validation pass does not run;
   * the refusal-grade drop gates (server-name reject, dangerous-arg scan) still
   * fire there. Each surviving server is then re-validated below after the
   * `_disabled` + selection + HTTP-pin filter, so a 2-server selection surfaces
   * warnings only about those 2 servers — not the other (e.g. disabled gitlab)
   * entries the repo never emits. Full-bundle validation remains available via
   * the default `readMcpConfig` mode for `hatch3r validate`.
   */
  protected async readFilteredMcp(
    ctx: AdapterContext,
  ): Promise<Record<string, CleanMcpEntry> | null> {
    if (!ctx.features.mcp || ctx.manifest.mcp.servers.length === 0) return null;
    // D11-16: skip the bundle-wide warn-only validation; it is re-run below on
    // the selected survivors only. Drop gates inside readMcpConfig still apply.
    const { servers: mcpServers, warnings } = await readMcpConfig(
      ctx.canonicalRoot,
      { validateEntries: false },
    );
    this.warnings.push(...warnings);
    if (Object.keys(mcpServers).length === 0) return null;
    const selectedSet = new Set(ctx.manifest.mcp.servers);
    const canonicalNames = new Set(Object.keys(mcpServers));
    // D11-M6 (Cycle 10 Wave-3 Medium, P2): surface manifest selections that
    // have no matching server in the bundled canonical mcp.json. The prior
    // implementation silently filtered these out — a user who adds a custom
    // server name to `.hatch3r/hatch.json::mcp.servers` (or whose canonical
    // bundle gets pruned after a hatch3r upgrade) saw zero indication that
    // the server was never emitted to the adapter output. Routed through
    // `this.warnings` (Silent Failure Contract, CONSTITUTION §2 P5) so the
    // operator sees which selection was dropped and can either fix the
    // manifest or rerun `hatch3r mcp` to align it with the bundled set.
    for (const selected of selectedSet) {
      if (!canonicalNames.has(selected)) {
        this.warnings.push(
          `MCP server "${selected}" listed in hatch.json::mcp.servers ` +
            `but not present in the bundled mcp/mcp.json — selection dropped. ` +
            `Run \`hatch3r mcp\` to align the manifest with the available servers.`,
        );
      }
    }
    const filtered: Record<string, CleanMcpEntry> = {};
    // D11-16: survivors of the _disabled + selection + HTTP-pin filter, keyed
    // by name, in their raw form (the warn-only validators read private
    // `_pinned_sha256`/`_trust_bypass`/`_timeout` markers). Per-entry
    // validateMcpEntry runs inside the loop on each survivor; scanMcpServers
    // runs once after the loop over the whole survivor set.
    const survivors: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(mcpServers)) {
      if (entry._disabled) continue;
      if (!selectedSet.has(name)) continue;
      // F15.5-H2 (D15 / Pillar P6): refuse-grade HTTP endpoint pin gate.
      // Parallel to the `_disabled` drop above — an unpinned HTTP transport
      // is dropped (not just warned) so the adapter never emits a client
      // config that trusts an unverifiable remote endpoint.
      const httpPolicy = validateMcpHttpEndpoint(entry);
      if (!httpPolicy.ok) {
        this.warnings.push(
          `MCP server "${name}" omitted from generated config: ${httpPolicy.reason ?? "HTTP endpoint pin policy violation"}`,
        );
        continue;
      }
      // D11-16: warn-only per-entry validation, scoped to this survivor.
      this.warnings.push(...validateMcpEntry(name, entry));
      survivors[name] = entry;
      const { _disabled, _description, ...clean } = entry;
      filtered[name] = clean;
    }
    // D11-16: description/tool-poisoning scan, scoped to the emitted survivors
    // only — never the unselected or disabled remainder of the bundle.
    if (Object.keys(survivors).length > 0) {
      this.warnings.push(...scanMcpServers(survivors));
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  /**
   * Build a standard MCP server configuration object from filtered entries.
   *
   * Emits a per-server `type` discriminator (`"stdio"` when `command` is set,
   * `"http"` when `url` is set) on every entry. The `type` field is required
   * by the VS Code MCP schema (verified against
   * https://code.visualstudio.com/docs/copilot/reference/mcp-configuration,
   * accessed 2026-05-27) and accepted as an additive field by Cursor and
   * Claude Code, so every consumer benefits.
   *
   * `envVarFormat` controls how `${env:VAR}` references are rewritten:
   *   - "claude"      → `${VAR}` (Claude Code native env-var syntax)
   *   - "shell"       → `$VAR` (legacy shell expansion; VS Code does NOT
   *                     perform this expansion, so prefer `envFileStrategy`
   *                     below for VS Code consumers)
   *   - "passthrough" → keep `${env:VAR}` as-is (Cursor / MCP spec native)
   *
   * D9-C-2 + D11-C-2 (Cycle 10, Pillars P3 + P6): on a VS Code consumer
   * (`.vscode/mcp.json`), shell `$VAR` is silently treated as a literal
   * string and `${env:VAR}` is unsupported — both leak the placeholder
   * verbatim and break every secret-bearing STDIO MCP server (github,
   * brave-search, sentry, postgres, linear, azure-devops, gitlab). Pass
   * `envFileStrategy: "${workspaceFolder}/.env.mcp"` to emit a per-entry
   * `envFile` field pointing at the hatch3r-managed `.env.mcp` file (which
   * already exists in the user repo; see `TOOL_SECRET_NOTES.copilot`) and
   * drop the otherwise-broken `env` object entirely. STDIO MCP servers
   * then receive their secrets via VS Code's native envFile-loading path.
   */
  protected buildStdMcpEntries(
    filtered: Record<string, CleanMcpEntry>,
    envVarFormat: "claude" | "shell" | "passthrough" = "passthrough",
    envFileStrategy?: string,
  ): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(filtered)) {
      if (server.command) {
        // D9-C-2: emit `type: "stdio"` per VS Code MCP schema. Cursor and
        // Claude Code accept the field as additive (each adapter already
        // emits an explicit `type` on its own MCP path; this centralises
        // the discriminator at the shared helper boundary).
        const entry: Record<string, unknown> = {
          type: "stdio",
          command: server.command,
          args: server.args || [],
        };
        // D11-C-2: STDIO secrets path. When the caller declares an
        // envFile strategy, route secrets via VS Code's native envFile
        // loader (`${workspaceFolder}/.env.mcp`) and drop the `env`
        // object — otherwise every value would still ship as a broken
        // `$VAR` literal that VS Code does not expand.
        if (envFileStrategy) {
          entry.envFile = envFileStrategy;
        } else if (server.env && Object.keys(server.env).length > 0) {
          entry.env = transformEnvVarSyntax(server.env, envVarFormat);
        }
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = transformEnvVarSyntax(server.headers, envVarFormat);
        }
        result[name] = entry;
      } else if (server.url) {
        // D9-C-2: emit `type: "http"` per VS Code MCP schema. The HTTP
        // path has no env object (secrets ride in headers); envFile is
        // not used here.
        const entry: Record<string, unknown> = { type: "http", url: server.url };
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = transformEnvVarSyntax(server.headers, envVarFormat);
        }
        result[name] = entry;
      }
    }
    return result;
  }

  protected async readHooks(ctx: AdapterContext) {
    if (!ctx.features.hooks) return [];
    // D5-SA5.7-H3 — Surface hook-parse diagnostics (invalid event, missing
    // field, YAML error, duplicate id) via the adapter warnings channel
    // instead of silently discarding malformed definitions.
    return readHookDefinitions(ctx.canonicalRoot, this.warnings);
  }

  /** Returns true when the adapter is running in minimal generation mode. */
  protected isMinimal(ctx: AdapterContext): boolean {
    return ctx.generationMode === "minimal";
  }

  /**
   * Replace the `<!-- HATCH3R:PLATFORM-TOOL -->` marker in canonical content
   * with the per-adapter platform-note paragraph. Idempotent and a no-op
   * when the marker is absent.
   *
   * See agents/shared/user-question-protocol.md and
   * src/pipeline/adapterToolTranslator.ts::toAskUserPlatformNote.
   */
  protected substituteAskUserMarker(content: string): string {
    if (!content.includes(PLATFORM_TOOL_MARKER)) return content;
    return content.split(PLATFORM_TOOL_MARKER).join(toAskUserPlatformNote(this.name));
  }

  /**
   * C9-H47 (D14-SA14.4-H01): Replace `${HATCH3R:LINTER}` /
   * `${HATCH3R:TEST_FRAMEWORK}` / `${HATCH3R:CI_PROVIDER}` tokens with the
   * detected values persisted on `ctx.manifest.detected`. Empty / absent
   * values collapse to the `"unknown"` sentinel — adapters emit a valid
   * sentence rather than a leaked template variable.
   *
   * Idempotent and a no-op when no token appears in the body. Called
   * after {@link substituteAskUserMarker} on every canonical body the
   * BaseAdapter helpers inline/emit so all 3 supported adapters get parity.
   *
   * See src/pipeline/repoSubstitution.ts for the token list and the
   * fallback / multi-value rendering contract.
   */
  protected substituteDetectedRepoTokens(content: string, ctx: AdapterContext): string {
    return substituteRepoTokens(content, detectionContextFromManifest(ctx.manifest));
  }

  /**
   * D14-M2 (Cycle 10 rollover): Replace verification-gate tokens
   * (`${HATCH3R:VERIFY_GATE_TEST}`, etc.) with the language-aware command
   * strings resolved from the project's manifest. Canonical agents
   * (hatch3r-implementer / hatch3r-fixer / hatch3r-reviewer) reference
   * these tokens in their Verify step so the generated adapter output
   * carries `pytest` for Python, `cargo test` for Rust, `pnpm run test`
   * for a pnpm-managed JS project, etc., rather than the historical
   * hard-coded `npm run test`. Idempotent: a body without any token
   * passes through unchanged.
   */
  protected substituteVerifyGateTokens(content: string, ctx: AdapterContext): string {
    return substituteVerificationGateTokens(content, ctx.manifest);
  }

  /**
   * Canonical-content post-processing pipeline. Composes every output-time
   * substitution helper in a fixed order so adapter call sites stay one
   * line and the substitution surface is identical across the 3 adapters
   * (parity invariant from D9 + the audit's D14-SA14.4-H01 wiring).
   *
   * Order:
   *  1. `substituteAskUserMarker`  — replaces the PLATFORM-TOOL marker.
   *  2. `substituteDetectedRepoTokens` — replaces detected LINTER /
   *     TEST_FRAMEWORK / CI_PROVIDER tokens.
   *  3. `substituteVerifyGateTokens` — D14-M2: replaces VERIFY_GATE_*
   *     tokens with language-aware command strings.
   *
   * Idempotent: a body without any tokens passes through unchanged.
   */
  protected substituteCanonicalContent(content: string, ctx: AdapterContext): string {
    return this.substituteVerifyGateTokens(
      this.substituteDetectedRepoTokens(this.substituteAskUserMarker(content), ctx),
      ctx,
    );
  }

  /**
   * Strip verbose content for minimal generation mode.
   * Removes markdown comments, collapses excessive blank lines,
   * strips decorative formatting, and trims descriptions.
   */
  protected stripMinimal(content: string): string {
    let result = content;
    // Remove HTML comments
    result = result.replace(/<!--[\s\S]*?-->/g, "");
    // Remove lines that are only horizontal rules
    result = result.replace(/^[-*_]{3,}\s*$/gm, "");
    // Collapse 3+ consecutive blank lines to a single blank line
    result = result.replace(/\n{3,}/g, "\n\n");
    // Trim leading/trailing whitespace
    result = result.trim();
    return result;
  }
}
