import type { AdapterOutput } from "../types.js";
import { parseCodexTomlDocument } from "../codex/tomlCodec.js";
import { codexProjectionIssues } from "./codexProjectionError.js";
import {
  collectCodexHatcherReferenceIssues,
  collectCodexVocabularyIssues,
} from "./codexProjectionTranslation.js";
import { findStandaloneHatcherSlashInvocations } from "./codexInvocations.js";

interface OperationalOutput {
  content?: string;
  issues: string[];
  nativeAgent: boolean;
}

function operationalOutput(output: AdapterOutput): OperationalOutput {
  const nativeAgent = /^\.codex\/agents\/[^/]+\.toml$/i.test(output.path);
  if (!nativeAgent) {
    return /\.(?:toml|json)$/i.test(output.path)
      ? { issues: [], nativeAgent: false }
      : { content: output.content, issues: [], nativeAgent: false };
  }
  try {
    const parsed = parseCodexTomlDocument(output.content, {
      schema: "custom-agent",
      source: output.path,
    });
    return { content: parsed.developer_instructions as string, issues: [], nativeAgent };
  } catch (error) {
    const message = (error as Error).message;
    return {
      issues: [`${output.path}: malformed native-agent TOML or schema violation: ${message}`],
      nativeAgent,
    };
  }
}

function lineReferenceIssues(
  path: string,
  content: string,
  outputPaths: ReadonlySet<string>,
  nativeAgent: boolean,
): string[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (isExemptLine(line)) return [];
    const issues: string[] = [];
    if (!nativeAgent) issues.push(...rawReferenceIssue(path, line, index));
    for (const match of line.matchAll(/\.hatch3r\/codex-support\/([A-Za-z0-9_.*{}?/-]+\.md)/g)) {
      const target = `.hatch3r/codex-support/${match[1]!}`;
      if (!/[?*{}]/.test(target) && target === path) {
        issues.push(`${path}: line ${index + 1}: self-referential projected target ${target}`);
      } else if (!/[?*{}]/.test(target) && !outputPaths.has(target)) {
        issues.push(`${path}: line ${index + 1}: missing projected target ${target}`);
      }
    }
    return issues;
  });
}

function isExemptLine(line: string): boolean {
  return /cross[- ]harness\s+(?:example|source).*claude/i.test(line) ||
    /\[(?:unsupported|unprojected) Hatcher|\[Hatcher development-only/.test(line);
}

function rawReferenceIssue(path: string, line: string, index: number): string[] {
  const reference = line.match(
    /(?<![A-Za-z0-9._/-])(?:(?:\.\.\/)+|\.\/)?(?:agents|rules|commands|checks|governance)\/[A-Za-z0-9_.*{}?/-]*(?:\.md|\/|\*)/,
  );
  return reference
    ? [`${path}: line ${index + 1}: unresolved Hatcher reference ${reference[0]}`]
    : [];
}

function scanOperationalOutput(
  output: AdapterOutput,
  outputPaths: ReadonlySet<string>,
): string[] {
  const operational = operationalOutput(output);
  if (!operational.content) return operational.issues;
  const issues = [...operational.issues];
  issues.push(...collectCodexVocabularyIssues(operational.content).map(
    (issue) => `${output.path}: ${issue}`,
  ));
  if (operational.nativeAgent) {
    issues.push(...collectCodexHatcherReferenceIssues(operational.content).map(
      (issue) => `${output.path}: ${issue}`,
    ));
  }
  const slash = operational.content.split(/\r?\n/).findIndex((line) =>
    !/cross[- ]harness\s+(?:example|source).*claude/i.test(line) &&
    findStandaloneHatcherSlashInvocations(line).length > 0);
  if (slash >= 0) {
    issues.push(`${output.path}: line ${slash + 1}: repository slash-command invocation`);
  }
  const corruptSkill = operational.content.split(/\r?\n/).findIndex((line) =>
    /[A-Za-z0-9.]\$hatch3r-[a-z0-9-]+/i.test(line));
  if (corruptSkill >= 0) {
    issues.push(`${output.path}: line ${corruptSkill + 1}: corrupt skill invocation boundary`);
  }
  issues.push(...lineReferenceIssues(
    output.path,
    operational.content,
    outputPaths,
    operational.nativeAgent,
  ));
  return issues;
}

/** Validate final emitted text, including dot-directories and companions. */
export function validateCodexOperationalOutputs(outputs: readonly AdapterOutput[]): void {
  const outputPaths = new Set(outputs.map((output) => output.path));
  const issues = outputs.flatMap((output) => scanOperationalOutput(output, outputPaths));
  if (issues.length === 0) return;
  throw codexProjectionIssues(
    "Codex output portability validation failed",
    [...new Set(issues)].sort(),
  );
}
