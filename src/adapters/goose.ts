import type { AdapterOutput, CanonicalFile } from "../types.js";
import { toPrefixedId } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext, type CleanMcpEntry } from "./base.js";
import { readCanonicalFiles } from "./canonical.js";
import { applyCustomization, applyCustomizationRaw } from "./customization.js";
import { stringify as yamlStringify } from "yaml";

// Goose profile structure — represents a `.goose/profiles/{name}.yaml` file.
// Goose reads profiles to configure agent behavior, extensions, and recipes.
interface GooseProfile {
  name: string;
  description: string;
  instructions: string;
  extensions?: GooseExtension[];
  recipes?: GooseRecipeRef[];
  /** ACP (Agent Communication Protocol) compatibility metadata. */
  acp?: GooseAcpConfig;
}

interface GooseExtension {
  name: string;
  type: "builtin" | "mcp";
  config?: Record<string, unknown>;
}

interface GooseRecipeRef {
  name: string;
  description: string;
  /** Steps map to hatch3r agent phases. */
  steps: GooseRecipeStep[];
}

interface GooseRecipeStep {
  instruction: string;
  /** Optional agent reference — maps to a hatch3r canonical agent. */
  agent?: string;
}

interface GooseAcpConfig {
  enabled: boolean;
  /** ACP protocol version supported by this configuration. */
  version: string;
  /** Agent capabilities advertised via ACP discovery. */
  capabilities: string[];
}

export class GooseAdapter extends BaseAdapter {
  readonly name = "goose";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const lines = [
      ...await this.bridgeHeader(ctx),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ];

    if (ctx.features.skills) {
      const skills = await readCanonicalFiles(ctx.agentsDir, "skills");
      for (const skill of skills) {
        const { content, skip, warnings } = await applyCustomizationRaw(ctx.projectRoot, skill);
        this.warnings.push(...warnings);
        if (skip) continue;
        lines.push(`## Skill: ${toPrefixedId(skill.id)}`, "", content, "");
      }
    }

    const inner = lines.join("\n");
    const results: AdapterOutput[] = [output(".goosehints", wrapInManagedBlock(inner), inner)];

    const mcp = await this.readFilteredMcp(ctx);
    if (mcp && Object.keys(mcp).length > 0) {
      const entries = this.buildStdMcpEntries(mcp);
      if (Object.keys(entries).length > 0) {
        const gooseMcp: Record<string, unknown> = {};
        for (const [name, entry] of Object.entries(entries)) {
          gooseMcp[name] = entry;
        }
        results.push(output(".goose/mcp.json", JSON.stringify(gooseMcp, null, 2)));
      }
    }

    // Generate Goose profile with recipe interoperability and ACP compatibility.
    const agents = ctx.features.agents
      ? await readCanonicalFiles(ctx.agentsDir, "agents")
      : [];
    const profile = await this.buildProfile(ctx, agents, mcp);
    const profileYaml = yamlStringify(profile);
    results.push(output(".goose/profiles/hatch3r.yaml", profileYaml));

    return results;
  }

  /** Build a Goose profile that maps hatch3r content to Goose's recipe system. */
  private async buildProfile(
    ctx: AdapterContext,
    agents: CanonicalFile[],
    mcp: Record<string, CleanMcpEntry> | null,
  ): Promise<GooseProfile> {
    const extensions = this.buildExtensions(mcp);
    const recipe = await this.buildRecipe(ctx, agents);
    const capabilities = this.deriveAcpCapabilities(ctx, agents);

    return {
      name: "hatch3r",
      description: `hatch3r-managed Goose profile for ${ctx.manifest.project || ctx.manifest.repo}. Provides agent pipeline, recipe interoperability, and ACP compatibility.`,
      instructions: `Follow the canonical agent instructions at .agents/AGENTS.md. Use the hatch3r 4-phase pipeline: Research, Implement, Review, Quality.`,
      ...(extensions.length > 0 ? { extensions } : {}),
      recipes: [recipe],
      acp: {
        enabled: true,
        version: "0.2",
        capabilities,
      },
    };
  }

  /** Map MCP servers to Goose extensions. */
  private buildExtensions(
    mcp: Record<string, CleanMcpEntry> | null,
  ): GooseExtension[] {
    if (!mcp) return [];
    const extensions: GooseExtension[] = [];
    for (const [name, entry] of Object.entries(mcp)) {
      if (entry.command) {
        extensions.push({
          name,
          type: "mcp",
          config: {
            command: entry.command,
            args: entry.args || [],
            ...(entry.env && Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
          },
        });
      } else if (entry.url) {
        extensions.push({
          name,
          type: "mcp",
          config: { url: entry.url },
        });
      }
    }
    return extensions;
  }

  /** Build a Goose recipe from hatch3r's agent pipeline. */
  private async buildRecipe(
    ctx: AdapterContext,
    agents: CanonicalFile[],
  ): Promise<GooseRecipeRef> {
    const steps: GooseRecipeStep[] = [];

    // Map hatch3r's 4-phase pipeline to Goose recipe steps.
    // Each step references a canonical agent when available.
    const phaseMap: Array<{ phase: string; agentPattern: string; fallback: string }> = [
      { phase: "Research", agentPattern: "researcher", fallback: "Gather context from the codebase. Identify affected files, patterns, and conventions. Do not modify any files." },
      { phase: "Implement", agentPattern: "implementer", fallback: "Implement the requested changes following project conventions. Require plan approval before making changes." },
      { phase: "Review", agentPattern: "reviewer", fallback: "Review all changes for correctness, style, security, and adherence to project rules. Report findings as Critical/Warning/Info." },
      { phase: "Quality", agentPattern: "test-writer", fallback: "Write or update tests for the implemented changes. Run the test suite and verify all tests pass." },
    ];

    for (const { phase, agentPattern, fallback } of phaseMap) {
      const matchingAgent = agents.find((a) =>
        a.id.includes(agentPattern),
      );
      if (matchingAgent) {
        const { skip, warnings } = await applyCustomization(ctx.projectRoot, matchingAgent);
        this.warnings.push(...warnings);
        if (!skip) {
          // Use the agent description as the step instruction,
          // or fall back to the default, truncated for recipe brevity.
          const instruction = matchingAgent.description || fallback;
          steps.push({
            instruction: `[${phase}] ${instruction}`,
            agent: toPrefixedId(matchingAgent.id),
          });
          continue;
        }
      }
      steps.push({ instruction: `[${phase}] ${fallback}` });
    }

    return {
      name: "hatch3r-pipeline",
      description: "hatch3r 4-phase development pipeline: Research, Implement, Review, Quality.",
      steps,
    };
  }

  /** Derive ACP capability advertisements from project configuration. */
  private deriveAcpCapabilities(
    ctx: AdapterContext,
    agents: CanonicalFile[],
  ): string[] {
    const capabilities: string[] = [
      "code-generation",
      "code-review",
    ];

    if (agents.some((a) => a.id.includes("test"))) {
      capabilities.push("test-generation");
    }
    if (agents.some((a) => a.id.includes("security"))) {
      capabilities.push("security-audit");
    }
    if (agents.some((a) => a.id.includes("docs"))) {
      capabilities.push("documentation");
    }
    if (ctx.features.mcp) {
      capabilities.push("tool-use");
    }

    return capabilities;
  }
}
