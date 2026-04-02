import { dirname } from "node:path";
import type {
  AdapterOutput,
  Features,
  GenerationMode,
  HatchManifest,
} from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { generateBridgeOrchestration } from "../cli/shared/agentsContent.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import { readMcpConfig, transformEnvVarSyntax, type McpServerEntry } from "./mcp-utils.js";
import { readHookDefinitions } from "../hooks/index.js";

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

    return outputs;
  }

  /**
   * Returns the list of output file paths this adapter would produce.
   * Override in subclasses for a lightweight implementation that avoids
   * full content generation when only paths are needed.
   */
  async getOutputPaths(agentsDir: string, manifest: HatchManifest): Promise<string[]> {
    const outputs = await this.generate(agentsDir, manifest);
    return outputs.map((o) => o.path);
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
    const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
    const minimal = this.isMinimal(ctx);
    for (const rule of rules) {
      const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
      this.warnings.push(...warnings);
      if (skip) continue;
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
    const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
    const minimal = this.isMinimal(ctx);
    for (const agent of agents) {
      const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
      this.warnings.push(...warnings);
      if (skip) continue;
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
    const skills = await readCanonicalFiles(ctx.agentsDir, "skills");
    for (const skill of skills) {
      const { content, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
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
    const skills = await readCanonicalFiles(ctx.agentsDir, "skills");
    for (const skill of skills) {
      const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, skill);
      this.warnings.push(...warnings);
      if (skip) continue;
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
    const commands = await readCanonicalFiles(ctx.agentsDir, "commands");
    for (const cmd of commands) {
      const { content, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, cmd);
      this.warnings.push(...warnings);
      if (skip) continue;
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
    return readHookDefinitions(ctx.agentsDir);
  }

  /** Returns true when the adapter is running in minimal generation mode. */
  protected isMinimal(ctx: AdapterContext): boolean {
    return ctx.generationMode === "minimal";
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
