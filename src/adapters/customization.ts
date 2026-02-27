import type { CanonicalFile } from "../types.js";
import {
  readCustomization,
  readCustomizationMarkdown,
  type Customization,
  type CustomizableType,
} from "../models/customize.js";

const TYPE_TO_DIR: Record<string, CustomizableType> = {
  agent: "agents",
  skill: "skills",
  command: "commands",
  rule: "rules",
};

export interface CustomizationResult {
  content: string;
  skip: boolean;
  overrides: Customization;
}

/**
 * Reads YAML + markdown customization files for a canonical file and returns
 * the combined content (canonical body + customize markdown) along with any
 * structured overrides. Adapters call this once per canonical file during
 * generation, then use `content` inside the managed block and `overrides`
 * to adjust frontmatter / metadata.
 */
export async function applyCustomization(
  projectRoot: string,
  file: CanonicalFile,
): Promise<CustomizationResult> {
  const dir = TYPE_TO_DIR[file.type];
  if (!dir) {
    return { content: file.content, skip: false, overrides: {} };
  }

  const [yaml, md] = await Promise.all([
    readCustomization(projectRoot, dir, file.id),
    readCustomizationMarkdown(projectRoot, dir, file.id),
  ]);

  const overrides: Customization = yaml ?? {};

  if (overrides.enabled === false) {
    return { content: file.content, skip: true, overrides };
  }

  let content = file.content;
  if (md) {
    content = `${content}\n\n---\n\n## Project Customizations\n\n${md}`;
  }

  return { content, skip: false, overrides };
}

/**
 * Same as applyCustomization but operates on rawContent (frontmatter + body)
 * instead of just the body. Used by adapters that pass rawContent through
 * the managed block (e.g., commands, some skill adapters).
 */
export async function applyCustomizationRaw(
  projectRoot: string,
  file: CanonicalFile,
): Promise<CustomizationResult> {
  const dir = TYPE_TO_DIR[file.type];
  if (!dir) {
    return { content: file.rawContent, skip: false, overrides: {} };
  }

  const [yaml, md] = await Promise.all([
    readCustomization(projectRoot, dir, file.id),
    readCustomizationMarkdown(projectRoot, dir, file.id),
  ]);

  const overrides: Customization = yaml ?? {};

  if (overrides.enabled === false) {
    return { content: file.rawContent, skip: true, overrides };
  }

  let content = file.rawContent;
  if (md) {
    content = `${content}\n\n---\n\n## Project Customizations\n\n${md}`;
  }

  return { content, skip: false, overrides };
}
