import { join } from "node:path";
import {
  toPrefixedId,
  type AdapterOutput,
  type CanonicalFile,
  type GenerationMode,
  type HatchManifest,
} from "../types.js";
import { resolveAgentEffort, resolveAgentModel } from "../models/resolve.js";
import { applyCustomization } from "./customization.js";
import { BaseAdapter, type AdapterContext } from "./base.js";
import { filterUserFacing } from "./canonical.js";
import {
  projectCodexContent,
  validateCodexOperationalOutputs,
  type CodexContentProjectionResult,
} from "./codexContentProjection.js";
import { projectCodexAgents, type CodexAgentNativeConfig } from "./codexAgents.js";
import {
  buildCodexInstructionReferenceMap,
  preflightCodexInstructions,
  projectCodexInstructions,
  CODEX_SUPPORT_ROOT,
  type CodexInstructionCompanion,
  type CodexInstructionPreflightResult,
  type CodexInstructionProjectionInput,
} from "./codexInstructions.js";
import { buildCodexConfigOutput } from "./codexConfig.js";
import { CODEX_HOOKS_PATH, projectCodexHooks } from "./codexHooks.js";
import { readCodexTomlPreflight, type CodexTomlPreflight } from "./codexToml.js";
import {
  preflightCodexOutputOwnership,
  preflightCodexProjectPaths,
} from "./codexSurfacePreflight.js";
import { codexProjectionIssues } from "./codexProjectionError.js";

interface CodexCanonicalSelection {
  customizedAgents: CanonicalFile[];
  selectedAgents: CanonicalFile[];
  allRules: CanonicalFile[];
  allCommands: CanonicalFile[];
  commands: CanonicalFile[];
  skills: CanonicalFile[];
}

interface CodexPreflight {
  instructions: CodexInstructionPreflightResult;
  config: CodexTomlPreflight;
}

interface CodexInstructionResult {
  outputs: AdapterOutput[];
  input: CodexInstructionProjectionInput;
}

/** Codex repository integration across native and explicitly bridged surfaces. */
export class CodexAdapter extends BaseAdapter {
  readonly name = "codex";

  override async generate(
    canonicalRoot: string,
    manifest: HatchManifest,
    userRepoRoot?: string,
    generationMode: GenerationMode = "standard",
    signal?: AbortSignal,
  ): Promise<AdapterOutput[]> {
    const outputs = await super.generate(
      canonicalRoot,
      manifest,
      userRepoRoot,
      generationMode,
      signal,
    );
    if (!outputs.some((output) => output.path === "AGENTS.override.md")) return outputs;
    return outputs.filter((output) =>
      output.path !== "AGENTS.md" || (output.sourceFiles?.length ?? 0) > 0
    );
  }

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const preflight = await this.preflight(ctx);
    const selection = await this.readCanonicalSelection(ctx);
    const content = await this.projectContent(ctx, selection);
    const instructions = await this.projectInstructions(ctx, selection, content, preflight);
    const nativeAgents = this.projectNativeAgents(ctx, selection, content, instructions.input);
    const configuration = await this.projectConfiguration(
      ctx,
      selection.selectedAgents,
      preflight.config,
    );
    const instructionPaths = new Set(instructions.outputs.map((output) => output.path));
    const outputs = [
      ...content.outputs.filter((output) => !instructionPaths.has(output.path)),
      ...instructions.outputs,
      ...nativeAgents,
      ...configuration,
    ];
    validateCodexOperationalOutputs(outputs);
    await preflightCodexOutputOwnership(
      ctx.projectRoot,
      outputs,
      new Set(ctx.manifest.managedFilesByAdapter?.codex ?? []),
    );
    return outputs;
  }

  private async preflight(ctx: AdapterContext): Promise<CodexPreflight> {
    const existing = await preflightCodexProjectPaths(ctx.projectRoot);
    const instructions = preflightCodexInstructions(existing);
    if (!instructions.ok) {
      throw codexProjectionIssues(
        "Codex project preflight failed",
        instructions.issues.map((issue) => issue.message),
        "Repair the conflicting Codex file or managed region; hatch3r did not emit partial Codex output.",
      );
    }
    return { instructions, config: await readCodexTomlPreflight(ctx.projectRoot) };
  }

  private async readCanonicalSelection(
    ctx: AdapterContext,
  ): Promise<CodexCanonicalSelection> {
    const allAgents = ctx.features.agents
      ? await this.readTrackedCanonicalFiles(ctx, "agents")
      : [];
    const allRules = ctx.features.rules
      ? await this.readTrackedCanonicalFiles(ctx, "rules")
      : [];
    const allCommands = ctx.features.commands
      ? await this.readTrackedCanonicalFiles(ctx, "commands")
      : [];
    const customizedAgents = await this.customizeCodexFiles(ctx, allAgents);
    const userAgents = filterUserFacing(
      allAgents,
      "agent",
      join(ctx.canonicalRoot, "agents"),
    );
    const paths = new Set(userAgents.map((agent) => agent.sourcePath));
    return {
      customizedAgents,
      selectedAgents: customizedAgents.filter((agent) => paths.has(agent.sourcePath)),
      allRules,
      allCommands,
      commands: filterUserFacing(allCommands, "command", join(ctx.canonicalRoot, "commands")),
      skills: ctx.features.skills ? await this.readCliFilteredSkills(ctx) : [],
    };
  }

  private async projectContent(
    ctx: AdapterContext,
    selection: CodexCanonicalSelection,
  ): Promise<CodexContentProjectionResult> {
    const availableAgentIds = new Set(
      selection.selectedAgents.map((agent) => toPrefixedId(agent.id)),
    );
    const content = await projectCodexContent({
      canonicalRoot: ctx.canonicalRoot,
      projectRoot: ctx.projectRoot,
      skills: selection.skills,
      commands: selection.commands,
      availableAgentIds,
      transformContent: (value) => this.substituteCanonicalContent(value, ctx),
    });
    this.warnings.push(...content.warnings);
    return content;
  }

  private async projectInstructions(
    ctx: AdapterContext,
    selection: CodexCanonicalSelection,
    content: CodexContentProjectionResult,
    preflight: CodexPreflight,
  ): Promise<CodexInstructionResult> {
    const input = await this.instructionInput(ctx, selection, content);
    input.companions = instructionCompanions(input, content.outputs);
    const hasSurface = (input.agents?.length ?? 0) > 0 ||
      (input.rules?.length ?? 0) > 0 ||
      (input.commands?.length ?? 0) > 0;
    const projection = hasSurface
      ? projectCodexInstructions(input, preflight.instructions)
      : { outputs: [], warnings: [] };
    this.warnings.push(...projection.warnings);
    return { outputs: projection.outputs, input };
  }

  private async instructionInput(
    ctx: AdapterContext,
    selection: CodexCanonicalSelection,
    content: CodexContentProjectionResult,
  ): Promise<CodexInstructionProjectionInput> {
    const commandSkillIds = new Map(selection.commands.map((command) => [
      command.id,
      content.commandSkillIds.get(command.sourcePath || command.id) ??
        `hatch3r-command-${command.id.replace(/^hatch3r-/, "")}`,
    ]));
    if (ctx.features.handoffs && !commandSkillIds.has("hatch3r-handoff")) {
      this.warnings.push(
        "[codex] Handoff bridge requested but hatch3r-handoff is not selected; no dangling handoff invocation was emitted.",
      );
    }
    return {
      agents: selection.customizedAgents,
      rules: await this.customizeCodexFiles(ctx, selection.allRules),
      commands: await this.customizeCodexFiles(ctx, selection.allCommands),
      availableSkillIds: content.discovery.entries.map((entry) => entry.name),
      commandSkillIds,
      handoffsEnabled: ctx.features.handoffs,
    };
  }

  private projectNativeAgents(
    ctx: AdapterContext,
    selection: CodexCanonicalSelection,
    content: CodexContentProjectionResult,
    instructionInput: CodexInstructionProjectionInput,
  ): AdapterOutput[] {
    if (!ctx.features.agents) return [];
    const config = Object.fromEntries(selection.selectedAgents.map((agent) => [
      agent.id,
      nativeAgentConfig(agent, ctx.manifest),
    ]));
    return projectCodexAgents(selection.selectedAgents, {
      agents: config,
      referenceMap: buildCodexInstructionReferenceMap(instructionInput),
      availableSkillIds: new Set(content.discovery.entries.map((entry) => entry.name)),
      warnings: this.warnings,
    });
  }

  private async projectConfiguration(
    ctx: AdapterContext,
    selectedAgents: CanonicalFile[],
    configPreflight: CodexTomlPreflight,
  ): Promise<AdapterOutput[]> {
    const selectedIds = new Set(selectedAgents.map((agent) => toPrefixedId(agent.id)));
    const hooks = (await this.readHooks(ctx)).filter((hook) => {
      const available = selectedIds.has(toPrefixedId(hook.agent));
      if (!available) this.warnings.push(missingHookAgentWarning(hook.id, hook.agent));
      return available;
    });
    const hookProjection = await projectCodexHooks(ctx.projectRoot, hooks, configPreflight);
    this.warnings.push(...hookProjection.warnings);
    for (const output of hookProjection.outputs) {
      if (output.path === CODEX_HOOKS_PATH) output.validatedFullDocument = true;
    }
    const config = buildCodexConfigOutput(
      configPreflight,
      await this.readFilteredMcp(ctx) ?? {},
      hookProjection.inlineToml,
    );
    if (config) config.sourceFiles = hookProjection.inlineToml ? hookProjection.sourceFiles : [];
    return [...hookProjection.outputs, ...(config ? [config] : [])];
  }

  private async customizeCodexFiles(
    ctx: AdapterContext,
    files: readonly CanonicalFile[],
  ): Promise<CanonicalFile[]> {
    const projected: CanonicalFile[] = [];
    for (const file of files) {
      this.throwIfAborted(ctx);
      const customized = await applyCustomization(ctx.projectRoot, file);
      this.warnings.push(...customized.warnings);
      if (customized.skip) continue;
      projected.push({
        ...file,
        content: this.substituteCanonicalContent(customized.content, ctx),
        description: customized.overrides.description ?? file.description,
        model: customized.overrides.model ?? file.model,
        effort: customized.overrides.effort ?? file.effort,
      });
    }
    return projected;
  }
}

function instructionCompanions(
  input: CodexInstructionProjectionInput,
  outputs: readonly AdapterOutput[],
): CodexInstructionCompanion[] {
  const directPaths = new Set(buildCodexInstructionReferenceMap(input).values());
  return outputs.flatMap((output) => {
    const prefix = `${CODEX_SUPPORT_ROOT}/`;
    if (!output.path.startsWith(prefix) || directPaths.has(output.path)) return [];
    const match = output.path.slice(prefix.length).match(/^(agents|rules|commands)\/(.+)$/);
    if (!match) return [];
    return [{
      class: match[1] as CodexInstructionCompanion["class"],
      relativePath: match[2]!,
      content: output.managedContent ?? output.content,
      sourcePath: output.sourceFiles?.[0] ?? output.path,
    }];
  });
}

function nativeAgentConfig(
  agent: CanonicalFile,
  manifest: HatchManifest,
): CodexAgentNativeConfig {
  const model = resolveAgentModel(agent.id, agent, manifest);
  const effort = resolveAgentEffort(agent.id, agent);
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    sandboxMode: "workspace-write",
  };
}

function missingHookAgentWarning(hookId: string, agentId: string): string {
  return `[codex] Hook "${hookId}" omitted: its target custom agent "${toPrefixedId(agentId)}" is not selected for Codex.`;
}
