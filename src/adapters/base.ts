import { dirname } from "node:path";
import type {
  AdapterOutput,
  Features,
  HatchManifest,
} from "../types.js";
import { resolveAgentModel } from "../models/resolve.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BRIDGE_ORCHESTRATION } from "../cli/shared/agentsContent.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import { readMcpConfig, type McpServerEntry } from "./mcp-utils.js";
import { readHookDefinitions } from "../hooks/index.js";

export interface Adapter {
  name: string;
  warnings: string[];
  generate(agentsDir: string, manifest: HatchManifest): Promise<AdapterOutput[]>;
  getOutputPaths(agentsDir: string, manifest: HatchManifest): Promise<string[]>;
}

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

  async generate(agentsDir: string, manifest: HatchManifest): Promise<AdapterOutput[]> {
    this.warnings = [];
    return this.doGenerate({
      agentsDir,
      manifest,
      features: manifest.features,
      projectRoot: dirname(agentsDir),
    });
  }

  async getOutputPaths(agentsDir: string, manifest: HatchManifest): Promise<string[]> {
    const outputs = await this.generate(agentsDir, manifest);
    return outputs.map((o) => o.path);
  }

  protected abstract doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]>;

  protected bridgeHeader(agentsPath = "/.agents/AGENTS.md"): string[] {
    return [
      "",
      "# Hatch3r Agent Instructions",
      "",
      `Full canonical agent instructions are at \`${agentsPath}\`.`,
      "",
      BRIDGE_ORCHESTRATION,
      "",
    ];
  }

  protected async inlineRules(ctx: AdapterContext): Promise<string[]> {
    if (!ctx.features.rules) return [];
    const lines: string[] = [];
    const rules = await readCanonicalFiles(ctx.agentsDir, "rules");
    for (const rule of rules) {
      const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, rule);
      this.warnings.push(...warnings);
      if (skip) continue;
      const desc = overrides.description ?? rule.description;
      lines.push(`## ${rule.id}`, "", desc, "", content, "");
    }
    return lines;
  }

  protected async inlineAgents(
    ctx: AdapterContext,
    formatModel?: (model: string) => ModelFormat,
  ): Promise<string[]> {
    if (!ctx.features.agents) return [];
    const lines: string[] = [];
    const agents = await readCanonicalFiles(ctx.agentsDir, "agents");
    for (const agent of agents) {
      const { content, skip, overrides, warnings } = await applyCustomization(ctx.projectRoot, agent);
      this.warnings.push(...warnings);
      if (skip) continue;
      const model = resolveAgentModel(agent.id, agent, ctx.manifest, overrides);
      const desc = overrides.description ?? agent.description;
      const fmt = model ? (formatModel ?? defaultModelFormat)(model) : undefined;
      lines.push(`## Agent: ${agent.id}`);
      if (fmt && !fmt.after) lines.push(fmt.text);
      lines.push("", desc, "", content);
      if (fmt?.after) lines.push("", fmt.text);
      lines.push("");
    }
    return lines;
  }

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

  protected async readFilteredMcp(
    ctx: AdapterContext,
  ): Promise<Record<string, CleanMcpEntry> | null> {
    if (!ctx.features.mcp || ctx.manifest.mcp.servers.length === 0) return null;
    const { servers: mcpServers, warnings } = await readMcpConfig(ctx.agentsDir);
    this.warnings.push(...warnings);
    if (Object.keys(mcpServers).length === 0) return null;
    const filtered: Record<string, CleanMcpEntry> = {};
    for (const [name, entry] of Object.entries(mcpServers)) {
      if (entry._disabled) continue;
      const { _disabled, _description, ...clean } = entry;
      filtered[name] = clean;
    }
    return filtered;
  }

  protected buildStdMcpEntries(
    filtered: Record<string, CleanMcpEntry>,
  ): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(filtered)) {
      if (server.command) {
        result[name] = {
          command: server.command,
          args: server.args || [],
          ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
        };
      } else if (server.url) {
        result[name] = { url: server.url };
      }
    }
    return result;
  }

  protected async readHooks(ctx: AdapterContext) {
    if (!ctx.features.hooks) return [];
    return readHookDefinitions(ctx.agentsDir);
  }
}
