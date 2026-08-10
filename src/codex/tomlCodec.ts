import { parse, type TomlTable } from "smol-toml";
import { HatchError } from "../types.js";

export type CodexTomlSchema = "project" | "custom-agent";

export interface CodexTomlParseOptions {
  schema: CodexTomlSchema;
  source: string;
}

const CUSTOM_AGENT_ROOT_FIELDS = new Set([
  "description",
  "developer_instructions",
  "mcp_servers",
  "model",
  "model_reasoning_effort",
  "name",
  "sandbox_mode",
  "skills",
]);

function codecError(message: string, source: string): HatchError {
  return new HatchError(
    message,
    1,
    "VALIDATION_ERROR",
    `Repair ${source}; hatch3r will not emit invalid Codex TOML.`,
  );
}

function validateCustomAgentRoot(parsed: TomlTable, source: string): void {
  const unknown = Object.keys(parsed).filter((key) => !CUSTOM_AGENT_ROOT_FIELDS.has(key));
  if (unknown.length > 0) {
    throw codecError(
      `${source} contains unsupported custom-agent field(s): ${unknown.sort().join(", ")}.`,
      source,
    );
  }
  for (const field of ["name", "description", "developer_instructions"] as const) {
    if (typeof parsed[field] !== "string" || parsed[field].length === 0) {
      throw codecError(`${source} requires a non-empty ${field} string.`, source);
    }
  }
}

/** Parse TOML and apply the selected Codex surface's root schema. */
export function parseCodexTomlDocument(
  content: string,
  options: CodexTomlParseOptions,
): TomlTable {
  let parsed: TomlTable;
  try {
    parsed = parse(content);
  } catch (error) {
    throw codecError(
      `${options.source} is malformed TOML: ${error instanceof Error ? error.message : String(error)}`,
      options.source,
    );
  }
  if (options.schema === "custom-agent") validateCustomAgentRoot(parsed, options.source);
  return parsed;
}

/** TOML basic string using the JSON-compatible escape subset. */
export function encodeCodexTomlString(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Prefer a bare TOML key when safe; quote every other key. */
export function encodeCodexTomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : encodeCodexTomlString(value);
}

export function encodeCodexTomlStringArray(values: readonly string[]): string {
  return `[${values.map(encodeCodexTomlString).join(", ")}]`;
}

export function renderCodexTomlStringTable(
  tablePath: string,
  values: Readonly<Record<string, string>>,
  quoteKeys = false,
): string[] {
  const keys = Object.keys(values).sort(compareCodeUnits);
  if (keys.length === 0) return [];
  return [
    `[${tablePath}]`,
    ...keys.map((key) => {
      const encodedKey = quoteKeys ? encodeCodexTomlString(key) : encodeCodexTomlKey(key);
      return `${encodedKey} = ${encodeCodexTomlString(values[key]!)}`;
    }),
  ];
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
