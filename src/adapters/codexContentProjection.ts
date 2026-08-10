import { dirname, extname } from "node:path";
import type { AdapterOutput, CanonicalFile } from "../types.js";
import { wrapManagedFor } from "../merge/managedBlocks.js";
import {
  collectCodexSupportClosure,
  type CodexSupportClosure,
  walkCodexCompanionFiles,
} from "./codexCompanion.js";
import type { CodexDiscoveryCatalog } from "./codexDiscovery.js";
import {
  assertSafeCodexRelativePath,
  canonicalCodexReferenceKey,
  codexSupportOutputPath,
  extractCodexCanonicalReferences,
  rewriteCodexCanonicalReferences,
  type CodexReferenceResolver,
} from "./codexReference.js";
import type { CodexTranslationContext } from "./codexProjectionTranslation.js";
import { translateCodexNativeContent } from "./codexProjectionTranslation.js";
import {
  planCodexSurfaces,
  type CodexProjectedPrimary,
} from "./codexSurfacePlan.js";
import { validateCodexOperationalOutputs } from "./codexSurfaceValidation.js";
import { CodexProjectionError } from "./codexProjectionError.js";

export {
  CODEX_DISCOVERY_FALLBACK_CHAR_BUDGET,
  buildCodexDiscoveryCatalog,
} from "./codexDiscovery.js";
export { CodexProjectionError as CodexContentProjectionError } from "./codexProjectionError.js";
export {
  buildCodexCommandSkillIds,
  translateCodexNativeContent,
} from "./codexProjectionTranslation.js";
export { CODEX_REPORT_OMISSION_WARNING } from "./codexSurfacePlan.js";
export { validateCodexOperationalOutputs } from "./codexSurfaceValidation.js";

const MARKER_SAFE_EXTENSIONS = new Set([".md", ".markdown", ".yaml", ".yml"]);

export interface CodexContentProjectionOptions {
  canonicalRoot: string;
  projectRoot: string;
  skills: CanonicalFile[];
  commands?: CanonicalFile[];
  availableAgentIds?: ReadonlySet<string>;
  discoveryBudget?: number;
  transformContent?: (content: string, file: CanonicalFile) => string;
}

export interface CodexContentProjectionResult {
  outputs: AdapterOutput[];
  warnings: string[];
  discovery: CodexDiscoveryCatalog;
  omitted: string[];
  commandSkillIds: ReadonlyMap<string, string>;
  supportFiles: string[];
}

function yamlScalar(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, " "));
}

function makeManagedOutput(
  path: string,
  content: string,
  sourceFiles: string[],
): AdapterOutput {
  if (!MARKER_SAFE_EXTENSIONS.has(extname(path).toLowerCase())) {
    return { path, content, action: "create", sourceFiles };
  }
  return {
    path,
    content: wrapManagedFor(path, content),
    managedContent: content,
    action: "create",
    sourceFiles,
  };
}

function makeSkillOutput(primary: CodexProjectedPrimary, body: string): AdapterOutput {
  const frontmatter = `---\nname: ${primary.id}\ndescription: ${yamlScalar(primary.description)}\n---`;
  const managedContent = body.trim();
  return {
    path: primary.outputPath,
    content: `${frontmatter}\n\n${wrapManagedFor(primary.outputPath, managedContent)}`,
    managedContent,
    action: "create",
    sourceFiles: primary.file.sourcePath ? [primary.file.sourcePath] : [],
  };
}

function initialSupportReferences(
  primaries: readonly CodexProjectedPrimary[],
  canonicalRoot: string,
): string[] {
  return primaries.flatMap((primary) => [
    ...extractCodexCanonicalReferences(primary.body, primary.file.sourcePath, canonicalRoot),
    ...primary.structuredReferences.map(canonicalCodexReferenceKey),
  ]);
}

function supportResolver(closure: CodexSupportClosure): CodexReferenceResolver {
  return {
    targets: new Map([...closure.support.keys()].map((key) => [key, codexSupportOutputPath(key)])),
    aliases: closure.aliases,
    unsupportedKeys: closure.unresolved,
    preserveUnknown: true,
  };
}

function withSupportReferenceNotice(
  body: string,
  references: string[],
  resolver: CodexReferenceResolver,
): string {
  const projected = references.flatMap((reference) => {
    const sourceKey = canonicalCodexReferenceKey(reference);
    const key = resolver.aliases?.get(sourceKey) ?? sourceKey;
    const target = resolver.targets.get(key);
    return target ? [target] : [];
  });
  if (projected.length === 0) return body;
  const lines = projected.map((path) => `- \`${path}\``);
  return `> Hatcher support references (read when the workflow uses them):\n${lines.join("\n")}\n\n${body}`;
}

function projectPrimaryBody(
  primary: CodexProjectedPrimary,
  resolver: CodexReferenceResolver,
  canonicalRoot: string,
  translationContext: Omit<CodexTranslationContext, "kind">,
): string {
  const rewritten = rewriteCodexCanonicalReferences(
    primary.body,
    resolver,
    primary.file.sourcePath,
    canonicalRoot,
  );
  const noticed = withSupportReferenceNotice(
    rewritten,
    primary.structuredReferences,
    resolver,
  );
  return translateCodexNativeContent(noticed, {
    ...translationContext,
    kind: primary.kind,
  });
}

async function projectCompanions(
  primary: CodexProjectedPrimary,
  resolver: CodexReferenceResolver,
  canonicalRoot: string,
  translationContext: Omit<CodexTranslationContext, "kind">,
): Promise<AdapterOutput[]> {
  if (primary.kind !== "skill" || !primary.file.sourcePath) return [];
  const companions = await walkCodexCompanionFiles(dirname(primary.file.sourcePath));
  return companions.flatMap((companion) => {
    if (companion.absolutePath === primary.file.sourcePath || companion.relativePath === "SKILL.md") {
      return [];
    }
    const relativePath = assertSafeCodexRelativePath(
      companion.relativePath,
      `Companion for ${primary.id}`,
    );
    const target = `.agents/skills/${primary.id}/${relativePath}`;
    const rewritten = rewriteCodexCanonicalReferences(
      companion.content,
      resolver,
      companion.absolutePath,
      canonicalRoot,
    );
    const translated = translateCodexNativeContent(rewritten, {
      ...translationContext,
      kind: "support",
    });
    return [makeManagedOutput(target, translated, [companion.absolutePath])];
  });
}

async function projectPrimaryOutputs(
  primaries: CodexProjectedPrimary[],
  resolver: CodexReferenceResolver,
  canonicalRoot: string,
  translationContext: Omit<CodexTranslationContext, "kind">,
  discovery: CodexDiscoveryCatalog,
): Promise<AdapterOutput[]> {
  const descriptions = new Map(discovery.entries.map((entry) => [entry.path, entry.description]));
  const outputs: AdapterOutput[] = [];
  for (const primary of [...primaries].sort((left, right) =>
    left.outputPath.localeCompare(right.outputPath))) {
    const projected = {
      ...primary,
      description: descriptions.get(primary.outputPath) ?? primary.description,
    };
    outputs.push(makeSkillOutput(
      projected,
      projectPrimaryBody(primary, resolver, canonicalRoot, translationContext),
    ));
    outputs.push(...await projectCompanions(
      primary,
      resolver,
      canonicalRoot,
      translationContext,
    ));
  }
  return outputs;
}

function projectSupportOutputs(
  closure: CodexSupportClosure,
  resolver: CodexReferenceResolver,
  canonicalRoot: string,
  translationContext: Omit<CodexTranslationContext, "kind">,
): AdapterOutput[] {
  return [...closure.support.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reference, file]) => {
      const outputPath = codexSupportOutputPath(reference);
      const rewritten = rewriteCodexCanonicalReferences(
        file.content,
        { ...resolver, currentTarget: outputPath, selfReferenceText: "this support file" },
        file.absolutePath,
        canonicalRoot,
      );
      const translated = translateCodexNativeContent(rewritten, {
        ...translationContext,
        kind: "support",
      });
      return makeManagedOutput(outputPath, translated, [file.absolutePath]);
    });
}

function assertUniqueOutputPaths(outputs: readonly AdapterOutput[]): void {
  const seen = new Set<string>();
  for (const output of outputs) {
    if (seen.has(output.path)) {
      throw new CodexProjectionError(
        `Codex content projection produced duplicate output path ${output.path}`,
      );
    }
    seen.add(output.path);
  }
}

/** Project selected canonical skills, command bridges, and companion closure. */
export async function projectCodexContent(
  options: CodexContentProjectionOptions,
): Promise<CodexContentProjectionResult> {
  const plan = await planCodexSurfaces(options);
  const closure = await collectCodexSupportClosure(
    options.canonicalRoot,
    initialSupportReferences(plan.primaries, options.canonicalRoot),
  );
  const resolver = supportResolver(closure);
  const outputs = [
    ...await projectPrimaryOutputs(
      plan.primaries,
      resolver,
      options.canonicalRoot,
      plan.translationContext,
      plan.discovery,
    ),
    ...projectSupportOutputs(
      closure,
      resolver,
      options.canonicalRoot,
      plan.translationContext,
    ),
  ].sort((left, right) => left.path.localeCompare(right.path));
  assertUniqueOutputPaths(outputs);
  validateCodexOperationalOutputs(outputs);
  return {
    outputs,
    warnings: [...plan.warnings, ...closure.warnings],
    discovery: plan.discovery,
    omitted: plan.omitted,
    commandSkillIds: plan.commandSkillIds,
    supportFiles: [...closure.support.keys()].sort(),
  };
}
