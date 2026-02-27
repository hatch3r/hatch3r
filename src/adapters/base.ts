import type { AdapterOutput, HatchManifest } from "../types.js";

export interface Adapter {
  name: string;
  generate(agentsDir: string, manifest: HatchManifest): Promise<AdapterOutput[]>;
}

export function output(
  path: string,
  content: string,
  managedContent?: string,
): AdapterOutput {
  return { path, content, managedContent, action: "create" };
}
