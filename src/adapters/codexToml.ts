import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HatchError } from "../types.js";
import {
  CODEX_CONFIG_PATH,
  preflightCodexToml,
  type CodexTomlPreflight,
} from "../codex/projectToml.js";
import { encodeCodexTomlString } from "../codex/tomlCodec.js";

export {
  CODEX_CONFIG_PATH,
  CODEX_TOML_BLOCK_END,
  CODEX_TOML_BLOCK_START,
  mergeCodexTomlManagedRegion,
  parseCodexToml,
  preflightCodexToml,
  removeCodexTomlManagedRegion,
} from "../codex/projectToml.js";
export type { CodexTomlPreflight } from "../codex/projectToml.js";

function validationError(message: string, hint: string): HatchError {
  return new HatchError(message, 1, "VALIDATION_ERROR", hint);
}

export async function readCodexTomlPreflight(projectRoot: string): Promise<CodexTomlPreflight> {
  const path = join(projectRoot, CODEX_CONFIG_PATH);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw validationError(
        `${CODEX_CONFIG_PATH} must be a regular, non-symlink file.`,
        `Replace ${CODEX_CONFIG_PATH} with a regular file inside the repository; hatch3r does not follow shared-config symlinks.`,
      );
    }
    return preflightCodexToml(await readFile(path, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return preflightCodexToml("");
    throw err;
  }
}

export function assertNoCodexMcpCollisions(
  preflight: CodexTomlPreflight,
  managedServerNames: Iterable<string>,
): void {
  const collisions = [...managedServerNames]
    .filter((name) => preflight.userMcpServerNames.has(name))
    .sort();
  if (collisions.length === 0) return;
  throw validationError(
    `${CODEX_CONFIG_PATH} already defines user-owned MCP server table(s): ${collisions.join(", ")}.`,
    "Rename either the user-owned server or the hatch3r MCP selection; hatch3r will not overwrite an existing table.",
  );
}

export function tomlString(value: string): string {
  return encodeCodexTomlString(value);
}

export function tomlKey(value: string): string {
  return encodeCodexTomlString(value);
}
