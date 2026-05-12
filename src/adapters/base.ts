import { dirname, join } from "node:path";
import type {
  AdapterOutput,
  CanonicalFile,
  Features,
  GenerationMode,
  HatchManifest,
} from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { generateBridgeOrchestration } from "../cli/shared/agentsContent.js";
import { filterUserFacing, readCanonicalFiles, sortByPrecedence, type CanonicalType } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import { readMcpConfig, transformEnvVarSyntax, type McpServerEntry } from "./mcp-utils.js";
import { readHookDefinitions } from "../hooks/index.js";
import { toAskUserPlatformNote } from "../pipeline/adapterToolTranslator.js";

export interface Adapter {
  name: string;
  warnings: string[];
  generate(agentsDir: string, manifest: HatchManifest, generationMode?: GenerationMode): Promise<AdapterOutput[]>;
  getOutputPaths(agentsDir: string, manifest: HatchManifest): Promise<string[]>;
}

/** Convenience factory for creating an AdapterOutput with `action: "create"`. */
export function output(
  path: string,
  content: string,
  managedContent?: string,
): AdapterOutput {
  return { path, content, managedContent, action: "create" };
}

export interface AdapterContext {
  agentsDir: string;
  manifest: HatchManifest;
  features: Features;
  projectRoot: string;
  /** Generation verbosity mode. "minimal" strips comments, descriptions, and reduces formatting. */
  generationMode: GenerationMode;
}

export interface ModelFormat {
  text: string;
  after?: boolean;
}

export type CleanMcpEntry = Omit<McpServerEntry, "_disabled" | "_description">;

function defaultModelFormat(model: string): ModelFormat {
  return { text: `**Recommended model:** \`${model}\`` };
}

export abstract class BaseAdapter implements Adapter {
  abstract readonly name: string;
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
  async generate(agentsDir: string, manifest: HatchManifest, generationMode: GenerationMode = "standard"): Promise<AdapterOutput[]> {
    this.warnings = [];
    this._cachedOutputPaths = null; // Invalidate path cache on re-generation
    // C8-D12-M3: Reset per-invocation provenance tracker before doGenerate.
    // Helpers on this class (inlineRules, inlineAgents, processSkills*,
    // processCommandsRaw) push every canonical file they read into the set;
    // after doGenerate returns, the set is the closed list of canonical
    // files this adapter consumed in the current run.
    this._trackedSourceFiles = new Set<string>();
    const outputs = await this.doGenerate({
      agentsDir,
      manifest,
      features: manifest.features,
      projectRoot: dirname(agentsDir),
      generationMode,
    });

    // #119: Validate output invariants to catch generation bugs early
    for (const out of outputs) {
      if (out.path.startsWith("/") || out.path.includes("..")) {
        this.warnings.push(`[${this.name}] Invalid output path "${out.path}" — must be relative with no traversal`);
      }
      if (!out.content) {
        this.warnings.push(`[${this.name}] Empty content for output "${out.path}" — possible generation bug`);
      }
      if (out.managedContent && !out.content.includes(out.managedContent)) {
        this.warnings.push(`[${this.name}] managedContent is not a substring of content for "${out.path}"`);
      }
    }

    // C8-D12-M3: Attach per-output source provenance. Adapters that already
    // set `sourceFiles` explicitly (e.g. a single-canonical-file output path
    // that wants a tighter attribution than the adapter-wide tracked set)
    // retain their value — we only fill the default tracked set for outputs
    // that left the field unset. The tracked list is deterministic (sorted)
    // so downstream diffs over `.provenance.json` stay stable across runs.
    const trackedList = [...this._trackedSourceFiles].sort();
    if (trackedList.length > 0) {
      for (const out of outputs) {
        if (out.sourceFiles === undefined) {
          out.sourceFiles = trackedList;
        }
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
  async getOutputPaths(agentsDir: string, manifest: HatchManifest): Promise<string[]> {
    if (this._cachedOutputPaths) return this._cachedOutputPaths;
    const outputs = await this.generate(agentsDir, manifest);
    this._cachedOutputPaths = outputs.map((o) => o.path);
    return this._cachedOutputPaths;
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
    agentsDir: string,
    type: CanonicalType,
  ): Promise<CanonicalFile[]> {
    const files = await readCanonicalFiles(agentsDir, type, this.warnings);
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
    agentsDir: string,
    type: "commands" | "agents",
  ): Promise<CanonicalFile[]> {
    const files = await readCanonicalFiles(agentsDir, type, this.warnings);
    const expectedType = type === "commands" ? "command" : "agent";
    // `filterUserFacing` is keyed off `${agentsDir}/${type}` as the
    // base directory. User-tier files (under `${agentsDir}/user/${type}/`)
    // resolve to a relative path beginning with `..` so the helper's
    // safe-default keep branch lets them through unchanged — only canonical
    // companion subdirectories like `commands/board/` and `agents/modes/`
    // are filtered out. User files then run through {@link filterByAdapterScope}
    // for the `adapters: [...]` opt-out.
    const userFacing = filterUserFacing(files, expectedType, join(agentsDir, type));
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
    const orchestration = await generateBridgeOrchestration(ctx.agentsDir, ctx.manifest.content?.preset);
    return this.isMinimal(ctx) ? this.stripMinimal(orchestration) : orchestration;
  }

  protected async bridgeHeader(ctx: AdapterContext, agentsPath = "/.agents/AGENTS.md"): Promise<string[]> {
    const orchestration = await this.bridgeOrchestration(ctx);
    if (this.isMinimal(ctx)) {
      return [
        "",
        "# Hatch3r Agent Instructions",
        "",
        `Instructions: \`${agentsPath}\``,
        "",
        orchestration,
        "",
      ];
    }
    return [
      "",
      "# Hatch3r Agent Instructions",
      "",
      `Full canonical agent instructions are at \`${agentsPath}\`.`,
      "",
      orchestration,
      "",
    ];
  }

  /** Read canonical rules and format them as inline markdown sections. */
  protected async inlineRules(ctx: AdapterContext): Promise<string[]> {
    if (!ctx.features.rules) return [];
    const lines: string[] = [];
    // Wave B4: sort rules by precedence (critical -> high -> normal -> low,
    // id lexicographic tie-break) before concatenation so the 7 inline
    // adapters that pipe this helper into a single file (gemini, aider,
    // amp, goose, zed, antigravity, amazonq) emit rule sections in a
    // deterministic priority order. Rules without a `precedence` field fall
    // back to "normal" rank, so legacy fixtures keep their alphabetic order.
    const rules = sortByPrecedence(
      await this.readTrackedCanonicalFiles(ctx.agentsDir, "rules"),
    );
    const minimal = this.isMinimal(ctx);
    for (const rule of rules) {
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteAskUserMarker(raw);
      const desc = overrides.description ?? rule.description;
      if (minimal) {
        lines.push(`## ${rule.id}`, "", this.stripMinimal(content), "");
      } else {
        lines.push(`## ${rule.id}`, "", desc, "", content, "");
      }
    }
    return lines;
  }

  /** Read canonical agents and format them as inline markdown sections with optional model annotations. */
  protected async inlineAgents(
    ctx: AdapterContext,
    formatModel?: (model: string) => ModelFormat,
  ): Promise<string[]> {
    if (!ctx.features.agents) return [];
    const lines: string[] = [];
    const agents = await this.readUserFacingCanonicalFiles(ctx.agentsDir, "agents");
    const minimal = this.isMinimal(ctx);
    for (const agent of agents) {
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteAskUserMarker(raw);
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

  /** Process skills and output each as a raw managed-block file at the path returned by `pathFn`. */
  protected async processSkillsRaw(
    ctx: AdapterContext,
    pathFn: (id: string) => string,
  ): Promise<AdapterOutput[]> {
    if (!ctx.features.skills) return [];
    const results: AdapterOutput[] = [];
    const skills = await this.readTrackedCanonicalFiles(ctx.agentsDir, "skills");
    for (const skill of skills) {
      const { content: raw, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteAskUserMarker(raw);
      results.push(output(pathFn(skill.id), wrapInManagedBlock(content), content));
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
    const skills = await this.readTrackedCanonicalFiles(ctx.agentsDir, "skills");
    for (const skill of skills) {
      const { content: raw, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteAskUserMarker(raw);
      const desc = overrides.description ?? skill.description;
      const fm = `---\nname: ${skill.id}\ndescription: ${desc}\n---`;
      results.push(output(pathFn(skill.id), `${fm}\n\n${wrapInManagedBlock(content)}`, content));
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
    const commands = await this.readUserFacingCanonicalFiles(ctx.agentsDir, "commands");
    for (const cmd of commands) {
      const { content: raw, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, cmd);
      this.warnings.push(...warnings);
      if (skip) continue;
      const content = this.substituteAskUserMarker(raw);
      results.push(output(pathFn(cmd.id), wrapInManagedBlock(content), content));
    }
    return results;
  }

  /** Read MCP server config and filter to only the servers selected in the manifest. */
  protected async readFilteredMcp(
    ctx: AdapterContext,
  ): Promise<Record<string, CleanMcpEntry> | null> {
    if (!ctx.features.mcp || ctx.manifest.mcp.servers.length === 0) return null;
    const { servers: mcpServers, warnings } = await readMcpConfig(ctx.agentsDir);
    this.warnings.push(...warnings);
    if (Object.keys(mcpServers).length === 0) return null;
    const selectedSet = new Set(ctx.manifest.mcp.servers);
    const filtered: Record<string, CleanMcpEntry> = {};
    for (const [name, entry] of Object.entries(mcpServers)) {
      if (entry._disabled) continue;
      if (!selectedSet.has(name)) continue;
      const { _disabled, _description, ...clean } = entry;
      filtered[name] = clean;
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  /** Build a standard MCP server configuration object from filtered entries, with env var syntax transformation. */
  protected buildStdMcpEntries(
    filtered: Record<string, CleanMcpEntry>,
    envVarFormat: "claude" | "shell" | "passthrough" = "passthrough",
  ): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(filtered)) {
      if (server.command) {
        const entry: Record<string, unknown> = {
          command: server.command,
          args: server.args || [],
          ...(server.env && Object.keys(server.env).length > 0
            ? { env: transformEnvVarSyntax(server.env, envVarFormat) }
            : {}),
        };
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = transformEnvVarSyntax(server.headers, envVarFormat);
        }
        result[name] = entry;
      } else if (server.url) {
        const entry: Record<string, unknown> = { url: server.url };
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
    return readHookDefinitions(ctx.agentsDir, this.warnings);
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
    const MARKER = "<!-- HATCH3R:PLATFORM-TOOL -->";
    if (!content.includes(MARKER)) return content;
    return content.split(MARKER).join(toAskUserPlatformNote(this.name));
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
