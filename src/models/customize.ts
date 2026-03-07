import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { sanitizeId } from "../types.js";

export type CustomizableType = "agents" | "skills" | "commands" | "rules";

const MAX_CUSTOMIZE_YAML_BYTES = 10_240;

export interface Customization {
  model?: string;
  scope?: string;
  description?: string;
  enabled?: boolean;
}

export interface CustomizationReadResult {
  value: Customization | undefined;
  warnings: string[];
}

export type AgentCustomization = Customization;

export async function readCustomization(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<Customization | undefined> {
  const { value } = await readCustomizationWithWarnings(projectRoot, type, id);
  return value;
}

export async function readCustomizationWithWarnings(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<CustomizationReadResult> {
  const warnings: string[] = [];
  const safeId = sanitizeId(id);
  const filePath = join(projectRoot, ".hatch3r", type, `${safeId}.customize.yaml`);
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedBase)) {
    return { value: undefined, warnings };
  }
  const path = filePath;
  try {
    const raw = await readFile(path, "utf-8");
    if (Buffer.byteLength(raw, "utf-8") > MAX_CUSTOMIZE_YAML_BYTES) {
      warnings.push(`Customization YAML for "${id}" exceeds ${MAX_CUSTOMIZE_YAML_BYTES} bytes. Skipping.`);
      return { value: undefined, warnings };
    }
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return { value: undefined, warnings };

    const result: Customization = {};
    let hasValue = false;

    if (typeof parsed.model === "string" && parsed.model.length > 0) {
      result.model = parsed.model;
      hasValue = true;
    }
    if (typeof parsed.scope === "string" && parsed.scope.length > 0) {
      result.scope = parsed.scope;
      hasValue = true;
    }
    if (typeof parsed.description === "string" && parsed.description.length > 0) {
      result.description = parsed.description;
      hasValue = true;
    }
    if (typeof parsed.enabled === "boolean") {
      result.enabled = parsed.enabled;
      hasValue = true;
    }

    return { value: hasValue ? result : undefined, warnings };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && !(err instanceof Error && err.name.startsWith("YAML"))) throw err;
    return { value: undefined, warnings };
  }
}

export async function readCustomizationMarkdown(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<string | undefined> {
  const safeId = sanitizeId(id);
  const filePath = join(projectRoot, ".hatch3r", type, `${safeId}.customize.md`);
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedBase)) {
    return undefined;
  }
  const path = filePath;
  try {
    const content = await readFile(path, "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return undefined;
  }
}

