import type { AdapterOutput, CanonicalFile } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext, type CleanMcpEntry } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomizationRaw } from "./customization.js";
import { transformEnvVarSyntax } from "./mcp-utils.js";
import { stringify as yamlStringify } from "yaml";

// Goose profile structure — matches the actual Goose platform schema.
// Goose profiles live at `.goose/profiles/{name}.yaml` and configure
// instructions and extensions. MCP servers are configured as extensions
// within the profile (there is no separate mcp.json in Goose).
// Reference: https://block.github.io/goose/docs/getting-started/profiles
interface GooseProfile {
  instructions: string[];
  extensions?: GooseExtension[];
}

// Goose extension entry — configures an MCP server or builtin extension.
// `type` is "stdio" for command-based servers, "sse" for SSE-based servers,
// or "builtin" for Goose's built-in extensions.
// Reference: https://block.github.io/goose/docs/getting-started/using-extensions
interface GooseExtension {
  name: string;
  type: "stdio" | "sse" | "builtin";
  cmd?: string;
  args?: string[];
  env_keys?: string[];
  uri?: string;
  headers?: Record<string, string>;
  description?: string;
}

export class GooseAdapter extends BaseAdapter {
  readonly name = "goose";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    // #123: Read agents once and reuse for both inline content and profile generation
    // to avoid double readCanonicalFiles + double applyCustomization.
    const agents = ctx.features.agents
      ? await this.readUserFacingCanonicalFiles(ctx.agentsDir, "agents")
      : [];

    const lines = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ];

    if (ctx.features.skills) {
      const skills = await readCanonicalFiles(ctx.agentsDir, "skills", this.warnings);
      for (const skill of skills) {
        const { content, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, skill);
        this.warnings.push(...warnings);
        if (skip) continue;
        lines.push(`## Skill: ${toPrefixedId(skill.id)}`, "", content, "");
      }
    }

    const inner = lines.join("\n").trim();
    const results: AdapterOutput[] = [output(".goosehints", wrapInManagedBlock(inner), inner)];

    // MCP servers are configured as extensions within the Goose profile.
    // Goose does not use a separate mcp.json file — all MCP configuration
    // belongs in the profile's extensions array.
    const mcp = await this.readFilteredMcp(ctx);

    // Reuse agents already read above for profile generation
    const profile = this.buildProfile(ctx, agents, mcp);
    const profileYaml = yamlStringify(profile);
    results.push(output(".goose/profiles/hatch3r.yaml", profileYaml));

    return results;
  }

  /**
   * Build a Goose profile matching the actual Goose platform schema.
   *
   * Goose profiles use:
   * - `instructions`: array of instruction strings (not a single string)
   * - `extensions`: array of extension configs for MCP servers
   *
   * Goose does NOT support `recipes`, `acp`, `name`, or `description`
   * as top-level profile fields.
   */
  private buildProfile(
    ctx: AdapterContext,
    agents: CanonicalFile[],
    mcp: Record<string, CleanMcpEntry> | null,
  ): GooseProfile {
    const extensions = this.buildExtensions(mcp);

    const instructions: string[] = [
      `Follow the canonical agent instructions at .agents/AGENTS.md.`,
    ];

    // Add agent pipeline instructions directly.
    const phaseMap: Array<{ phase: string; agentPattern: string; fallback: string }> = [
      { phase: "Research", agentPattern: "researcher", fallback: "Gather context from the codebase. Identify affected files, patterns, and conventions. Do not modify any files." },
      { phase: "Implement", agentPattern: "implementer", fallback: "Implement the requested changes following project conventions. Require plan approval before making changes." },
      { phase: "Review", agentPattern: "reviewer", fallback: "Review all changes for correctness, style, security, and adherence to project rules. Report findings as Critical/Warning/Info." },
      { phase: "Quality", agentPattern: "test-writer", fallback: "Write or update tests for the implemented changes. Run the test suite and verify all tests pass." },
    ];

    for (const { phase, agentPattern, fallback } of phaseMap) {
      const matchingAgent = agents.find((a) => a.id.includes(agentPattern));
      const instruction = matchingAgent?.description || fallback;
      instructions.push(`[${phase}] ${instruction}`);
    }

    return {
      instructions,
      ...(extensions.length > 0 ? { extensions } : {}),
    };
  }

  /**
   * Map MCP servers to Goose extensions using the actual Goose schema.
   *
   * Goose uses:
   * - `type: "stdio"` with `cmd` and `args` for command-based servers
   * - `type: "sse"` with `uri` for URL-based servers
   * - `env_keys` for environment variable names (not values)
   */
  private buildExtensions(
    mcp: Record<string, CleanMcpEntry> | null,
  ): GooseExtension[] {
    if (!mcp) return [];
    const extensions: GooseExtension[] = [];
    for (const [name, entry] of Object.entries(mcp)) {
      if (entry.command) {
        const ext: GooseExtension = {
          name,
          type: "stdio",
          cmd: entry.command,
          args: entry.args || [],
        };
        if (entry.env && Object.keys(entry.env).length > 0) {
          ext.env_keys = Object.keys(entry.env);
        }
        if (entry.headers && Object.keys(entry.headers).length > 0) {
          ext.headers = transformEnvVarSyntax(entry.headers, "shell") as Record<string, string>;
        }
        extensions.push(ext);
      } else if (entry.url) {
        const ext: GooseExtension = {
          name,
          type: "sse",
          uri: entry.url,
        };
        if (entry.headers && Object.keys(entry.headers).length > 0) {
          ext.headers = transformEnvVarSyntax(entry.headers, "shell") as Record<string, string>;
        }
        extensions.push(ext);
      }
    }
    return extensions;
  }
}
