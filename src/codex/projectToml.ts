import type { TomlTable } from "smol-toml";
import { HatchError } from "../types.js";
import { CODEX_CONFIG_PATH } from "./surfacePaths.js";
import { parseCodexTomlDocument } from "./tomlCodec.js";

export { CODEX_CONFIG_PATH } from "./surfacePaths.js";
export const CODEX_TOML_BLOCK_START = "# HATCH3R:BEGIN";
export const CODEX_TOML_BLOCK_END = "# HATCH3R:END";
const CODEX_TOML_SEPARATOR_PREFIX = "# HATCH3R:SEPARATOR-BYTES=";

export interface CodexTomlPreflight {
  content: string;
  parsed: TomlTable;
  newline: "\n" | "\r\n";
  hasManagedRegion: boolean;
  hasInlineHooks: boolean;
  userMcpServerNames: ReadonlySet<string>;
}

interface ManagedRegion {
  start: number;
  markerStart: number;
  end: number;
  separator: string;
  hasSeparatorMetadata: boolean;
}

function validationError(message: string, hint: string): HatchError {
  return new HatchError(message, 1, "VALIDATION_ERROR", hint);
}

function lineMarkerOffsets(content: string, marker: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    const withoutNewline = line.replace(/\r?\n$/, "");
    if (withoutNewline.trim() === marker) offsets.push(offset + withoutNewline.search(/\S/));
    offset += line.length;
  }
  return offsets;
}

function managedMarkerPair(content: string): { start: number; end: number } | null {
  const starts = lineMarkerOffsets(content, CODEX_TOML_BLOCK_START);
  const ends = lineMarkerOffsets(content, CODEX_TOML_BLOCK_END);
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length === 1 && ends.length === 1 && starts[0]! < ends[0]!) {
    return { start: starts[0]!, end: ends[0]! };
  }
  throw validationError(
    `${CODEX_CONFIG_PATH} has broken or duplicate HATCH3R managed-region markers.`,
    `Restore exactly one ${CODEX_TOML_BLOCK_START} line followed by one ${CODEX_TOML_BLOCK_END} line, then re-run the command.`,
  );
}

function separatorMetadata(markerBody: string): { length: number; present: boolean } {
  const rows = markerBody.split(/\r?\n/)
    .filter((line) => line.startsWith(CODEX_TOML_SEPARATOR_PREFIX));
  if (rows.length > 1) {
    throw validationError(
      `${CODEX_CONFIG_PATH} has duplicate HATCH3R separator metadata.`,
      `Restore a single ${CODEX_TOML_SEPARATOR_PREFIX}<n> line inside the managed region, then re-run the command.`,
    );
  }
  const length = rows.length === 1 ? Number(rows[0]!.slice(CODEX_TOML_SEPARATOR_PREFIX.length)) : 0;
  if (!Number.isSafeInteger(length) || length < 0 || length > 4) {
    throw validationError(
      `${CODEX_CONFIG_PATH} has invalid HATCH3R separator metadata.`,
      `Restore ${CODEX_TOML_SEPARATOR_PREFIX}<n> with n between 0 and 4, then re-run the command.`,
    );
  }
  return { length, present: rows.length === 1 };
}

function findManagedRegion(content: string): ManagedRegion | null {
  const markers = managedMarkerPair(content);
  if (!markers) return null;
  const startLine = content.lastIndexOf("\n", markers.start - 1) + 1;
  const endLineBreak = content.indexOf("\n", markers.end);
  const markerBody = content.slice(markers.start + CODEX_TOML_BLOCK_START.length, markers.end);
  const metadata = separatorMetadata(markerBody);
  const separator = content.slice(startLine - metadata.length, startLine);
  if (metadata.length > 0 && !/^(?:\r?\n){1,2}$/.test(separator)) {
    throw validationError(
      `${CODEX_CONFIG_PATH} has HATCH3R separator metadata that does not match the preceding bytes.`,
      `Repair the managed region in ${CODEX_CONFIG_PATH}; hatch3r left the file untouched.`,
    );
  }
  return {
    start: startLine - metadata.length,
    markerStart: startLine,
    end: endLineBreak === -1 ? content.length : endLineBreak + 1,
    separator,
    hasSeparatorMetadata: metadata.present,
  };
}

export function parseCodexToml(content: string, source = CODEX_CONFIG_PATH): TomlTable {
  return parseCodexTomlDocument(content, { schema: "project", source });
}

function tableAt(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function preflightCodexToml(content: string): CodexTomlPreflight {
  const region = findManagedRegion(content);
  const parsed = parseCodexToml(content);
  const userContent = region ? content.slice(0, region.start) + content.slice(region.end) : content;
  const userParsed = parseCodexToml(userContent);
  return {
    content,
    parsed,
    newline: content.includes("\r\n") ? "\r\n" : "\n",
    hasManagedRegion: region !== null,
    hasInlineHooks: Object.keys(tableAt(userParsed.hooks) ?? {}).length > 0,
    userMcpServerNames: new Set(Object.keys(tableAt(userParsed.mcp_servers) ?? {})),
  };
}

function normalizeManagedBody(body: string, newline: "\n" | "\r\n"): string {
  return body.trim().replace(/\r?\n/g, newline);
}

/** Merge one hatch3r-owned TOML region while preserving every outside byte. */
export function mergeCodexTomlManagedRegion(existing: string, managedBody: string): string {
  const preflight = preflightCodexToml(existing);
  const newline = preflight.newline;
  const body = normalizeManagedBody(managedBody, newline);
  const region = findManagedRegion(existing);
  const separator = region
    ? region.separator
    : existing.length === 0
      ? ""
      : existing.endsWith(newline)
        ? existing.endsWith(newline + newline) ? "" : newline
        : newline + newline;
  const separatorMetadata = !region || region.hasSeparatorMetadata
    ? `${CODEX_TOML_SEPARATOR_PREFIX}${separator.length}${newline}`
    : "";
  const block = `${CODEX_TOML_BLOCK_START}${newline}${separatorMetadata}${body}${body ? newline : ""}${CODEX_TOML_BLOCK_END}${newline}`;
  const merged = region
    ? existing.slice(0, region.start) + separator + block + existing.slice(region.end)
    : existing.length === 0 ? block : existing + separator + block;
  parseCodexToml(merged);
  return merged;
}

/** Remove only the valid hatch3r TOML region and retain the user-owned TOML. */
export function removeCodexTomlManagedRegion(content: string): string {
  preflightCodexToml(content);
  const region = findManagedRegion(content);
  if (!region) return content;
  let remaining = content.slice(0, region.start) + content.slice(region.end);
  if (!region.hasSeparatorMetadata) {
    if (region.markerStart === 0 && remaining.startsWith("\n")) remaining = remaining.slice(1);
    if (remaining.endsWith("\r\n\r\n")) remaining = remaining.slice(0, -2);
    else if (remaining.endsWith("\n\n")) remaining = remaining.slice(0, -1);
  }
  parseCodexToml(remaining);
  return remaining;
}
