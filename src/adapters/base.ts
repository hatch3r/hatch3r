import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  AdapterOutput,
  CanonicalFile,
  Features,
  GenerationMode,
  HatchManifest,
} from "../types.js";
import { HatchError } from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import { generateBridgeOrchestration } from "../cli/shared/agentsContent.js";
import { resolveUserContentRoot } from "../content/index.js";
import { filterUserFacing, readCanonicalFiles, sortByPrecedence, type CanonicalType } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import {
  readMcpConfig,
  transformEnvVarSyntax,
  validateMcpHttpEndpoint,
  type McpServerEntry,
} from "./mcp-utils.js";
import { readHookDefinitions } from "../hooks/index.js";
import { PLATFORM_TOOL_MARKER, toAskUserPlatformNote } from "../pipeline/adapterToolTranslator.js";
import {
  detectionContextFromManifest,
  substituteRepoTokens,
  substituteVerificationGateTokens,
} from "../pipeline/repoSubstitution.js";

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
  getOutputPaths(canonicalRoot: string, manifest: HatchManifest): Promise<string[]>;
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
 * `agents/shared/`, `commands/board/`, `commands/revision/`, `checks/`).
 */
export const KNOWN_COMPANION_SUBDIRS = [
  "agents/modes",
  "agents/shared",
  "commands/board",
  "commands/revision",
  "checks",
] as const;

/** Union of the canonical companion-subdir literals (see {@link KNOWN_COMPANION_SUBDIRS}). */
export type CompanionSubdir = (typeof KNOWN_COMPANION_SUBDIRS)[number];

function defaultModelFormat(model: string): ModelFormat {
  return { text: `**Recommended model:** \`${model}\`` };
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
      (o) => o.path.startsWith("/") || o.path.includes(".."),
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
   * Caches the result so repeated calls do not re-generate.
   */
  private _cachedOutputPaths: string[] | null = null;
  async getOutputPaths(canonicalRoot: string, manifest: HatchManifest): Promise<string[]> {
    if (this._cachedOutputPaths) return this._cachedOutputPaths;
    const outputs = await this.generate(canonicalRoot, manifest);
    this._cachedOutputPaths = outputs.map((o) => o.path);
    return this._cachedOutputPaths;
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
   * External callers (outside BaseAdapter) should prefer calling
   * `readCanonicalFiles` directly; this wrapper is the BaseAdapter-internal
   * integration point for {@link AdapterOutput.sourceFiles} population.
   */
  protected async readTrackedCanonicalFiles(
    canonicalRoot: string,
    type: CanonicalType,
    userRepoRoot?: string,
  ): Promise<CanonicalFile[]> {
    // Wave 5: when an explicit user-repo root is plumbed, resolve to the
    // `.hatch3r/overrides/` subtree so D20 user-authored artifacts layer on
    // top of bundled canonical content. Undefined user root => canonical-only.
    const userContentRoot = userRepoRoot ? resolveUserContentRoot(userRepoRoot) : undefined;
    const files = await readCanonicalFiles(canonicalRoot, type, this.warnings, userContentRoot);
    const filtered = this.filterByAdapterScope(files);
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
   */
  protected async readUserFacingCanonicalFiles(
    canonicalRoot: string,
    type: "commands" | "agents",
    userRepoRoot?: string,
  ): Promise<CanonicalFile[]> {
    // Wave 5: same `.hatch3r/overrides/` lookup as readTrackedCanonicalFiles.
    const userContentRoot = userRepoRoot ? resolveUserContentRoot(userRepoRoot) : undefined;
    const files = await readCanonicalFiles(canonicalRoot, type, this.warnings, userContentRoot);
    const expectedType = type === "commands" ? "command" : "agent";
    // `filterUserFacing` is keyed off `${canonicalRoot}/${type}` as the base
    // directory. User-tier files (read via an explicit userContentRoot, Wave
    // 5+) resolve to a relative path beginning with `..` so the helper's
    // safe-default keep branch lets them through unchanged — only canonical
    // companion subdirectories like `commands/board/` and `agents/modes/`
    // are filtered out. User files then run through {@link filterByAdapterScope}
    // for the `adapters: [...]` opt-out.
    const userFacing = filterUserFacing(files, expectedType, join(canonicalRoot, type));
    const filtered = this.filterByAdapterScope(userFacing);
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
    );
    return this.isMinimal(ctx) ? this.stripMinimal(orchestration) : orchestration;
  }

  /**
   * Wave 4: `agentsPath` defaults to `"this file"` because the root
   * `AGENTS.md` is no longer emitted (W3) — the bridge file IS the
   * orchestration doc now. Callers may still pass a custom path for the
   * (rare) adapters that emit a sibling reference document.
   */
  protected async bridgeHeader(ctx: AdapterContext, agentsPath = "this file"): Promise<string[]> {
    const orchestration = await this.bridgeOrchestration(ctx);
    const isThisFile = agentsPath === "this file";
    if (this.isMinimal(ctx)) {
      return [
        "",
        "# Hatch3r Agent Instructions",
        "",
        isThisFile ? "Instructions inlined below." : `Instructions: \`${agentsPath}\``,
        "",
        orchestration,
        "",
      ];
    }
    return [
      "",
      "# Hatch3r Agent Instructions",
      "",
      isThisFile
        ? "Canonical agent orchestration is inlined in this file."
        : `Full canonical agent instructions are at \`${agentsPath}\`.`,
      "",
      orchestration,
      "",
    ];
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
      await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "rules", ctx.userRepoRoot),
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
    const agents = await this.readUserFacingCanonicalFiles(ctx.canonicalRoot, "agents", ctx.userRepoRoot);
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

  /** Process skills and output each as a raw managed-block file at the path returned by `pathFn`. */
  protected async processSkillsRaw(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.skills) return [];
    const results: AdapterOutput[] = [];
    const skills = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "skills", ctx.userRepoRoot);
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

  /** Process skills and output each with YAML frontmatter (name, description) at the path returned by `pathFn`. */
  protected async processSkillsWithFm(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.skills) return [];
    const results: AdapterOutput[] = [];
    const skills = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "skills", ctx.userRepoRoot);
    for (const skill of skills) {
      this.throwIfAborted(ctx);
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteCanonicalContent(raw, ctx);
      const desc = overrides.description ?? skill.description;
      const fm = `---\nname: ${skill.id}\ndescription: ${desc}\n---`;
      results.push(output(pathFn(skill.id), `${fm}\n\n${wrapManagedFor(pathFn(skill.id), content)}`, content, this.singleSource(skill)));
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
   * Wave 3 swaps each adapter's `processSkillsWithFm` /
   * `processSkillsRaw` call to the `*CliFiltered` variants below; the
   * filter helper is exposed protected so adapters with custom skill
   * pipelines can reuse it directly.
   */
  protected async readCliFilteredSkills(ctx: AdapterContext): Promise<CanonicalFile[]> {
    const all = await this.readTrackedCanonicalFiles(ctx.canonicalRoot, "skills", ctx.userRepoRoot);
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
   * CLI-filtered twin of {@link processSkillsRaw}. Adapters that emit
   * skills as raw managed-block files (no YAML frontmatter) call this
   * after Wave 3 instead of `processSkillsRaw` to honour
   * `manifest.cliTools.selected`.
   */
  protected async processSkillsRawCliFiltered(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.skills) return [];
    const results: AdapterOutput[] = [];
    const skills = await this.readCliFilteredSkills(ctx);
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
   * CLI-filtered twin of {@link processSkillsWithFm}. Adapters that emit
   * skills as managed-block files prefixed with a `name: + description:`
   * YAML stub call this after Wave 3 instead of `processSkillsWithFm`.
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
   */
  protected async processSkillsWithFmCliFiltered(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
    opts?: { emitAllowedTools?: boolean },
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
      const fmLines = [`name: ${skill.id}`, `description: ${desc}`];
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

  /** Process commands and output each as a raw managed-block file at the path returned by `pathFn`. */
  protected async processCommandsRaw(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.commands) return [];
    const results: AdapterOutput[] = [];
    // Filter out companion/reference content (shared-context, subdirectory
    // workflow steps like commands/board/pickup-*) so they do not appear
    // as user-invocable entries in the tool's command picker.
    const commands = await this.readUserFacingCanonicalFiles(ctx.canonicalRoot, "commands", ctx.userRepoRoot);
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
   * Emit companion/reference content from a canonical subdirectory.
   *
   * Companion content lives under support subdirectories of the canonical
   * tree (`agents/modes/`, `agents/shared/`, `commands/board/`,
   * `commands/revision/`, `checks/`) and is referenced by primary
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
   */
  protected async processCompanionSubdir(
    ctx: AdapterContext,
    canonicalSubdir: CompanionSubdir,
    pathFn: (filename: string) => string,
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

      const substituted = this.substituteCanonicalContent(raw, ctx);
      const body = minimal ? this.stripMinimal(substituted) : substituted;
      this._trackedSourceFiles.add(src);
      // D12-1: a companion file is single-source — its only canonical input is
      // `src` (the absolute path just read), so attribute it directly rather
      // than letting the adapter-wide fill stamp the broad read set.
      results.push(output(pathFn(entry.name), wrapManagedFor(pathFn(entry.name), body), body, [src]));
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
   */
  protected async readFilteredMcp(
    ctx: AdapterContext,
  ): Promise<Record<string, CleanMcpEntry> | null> {
    if (!ctx.features.mcp || ctx.manifest.mcp.servers.length === 0) return null;
    const { servers: mcpServers, warnings } = await readMcpConfig(ctx.canonicalRoot);
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
      const { _disabled, _description, ...clean } = entry;
      filtered[name] = clean;
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
