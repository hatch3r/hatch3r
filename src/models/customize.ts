import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type CustomizableType = "agents" | "skills" | "commands" | "rules";

export interface Customization {
  model?: string;
  scope?: string;
  description?: string;
  enabled?: boolean;
}

export type AgentCustomization = Customization;

export async function readCustomization(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<Customization | undefined> {
  const path = join(projectRoot, ".hatch3r", type, `${id}.customize.yaml`);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return undefined;

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

    return hasValue ? result : undefined;
  } catch {
    return undefined;
  }
}

export async function readCustomizationMarkdown(
  projectRoot: string,
  type: CustomizableType,
  id: string,
): Promise<string | undefined> {
  const path = join(projectRoot, ".hatch3r", type, `${id}.customize.md`);
  try {
    const content = await readFile(path, "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function readAgentCustomization(
  projectRoot: string,
  agentId: string,
): Promise<AgentCustomization | undefined> {
  return readCustomization(projectRoot, "agents", agentId);
}
