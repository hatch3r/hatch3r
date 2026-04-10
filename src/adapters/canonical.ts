import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CanonicalFile, CanonicalMetadata } from "../types.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/**
 * Parse YAML frontmatter from a markdown file's raw content.
 *
 * Returns the parsed metadata and the body content after the frontmatter block.
 * If the file has no frontmatter delimiters (`---`), returns empty metadata
 * and the full content as the body.
 */
export function parseFrontmatter(rawContent: string): {
  metadata: CanonicalMetadata;
  content: string;
} {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      metadata: { id: "", type: "rule", description: "" },
      content: rawContent,
    };
  }

  const [, frontmatterStr, content = ""] = match;
  const parsed = parseYaml(frontmatterStr ?? "") as Record<string, unknown> | null;
  const metadata: CanonicalMetadata = {
    id: "",
    type: "rule",
    description: "",
  };

  if (parsed && typeof parsed === "object") {
    if (typeof parsed.id === "string") metadata.id = parsed.id;
    if (typeof parsed.type === "string") metadata.type = parsed.type;
    if (typeof parsed.description === "string") metadata.description = parsed.description;
    if (typeof parsed.name === "string") metadata.name = parsed.name;
    if (typeof parsed.scope === "string") metadata.scope = parsed.scope;
    if (typeof parsed.model === "string") metadata.model = parsed.model;
    if (typeof parsed.agent === "string") metadata.agent = parsed.agent;
    if (typeof parsed.event === "string") metadata.event = parsed.event;
    if (typeof parsed.globs === "string") metadata.globs = parsed.globs;
    if (typeof parsed.protected === "boolean") metadata.protected = parsed.protected;
    if (typeof parsed.alwaysApply === "boolean") metadata.alwaysApply = parsed.alwaysApply;
    if (typeof parsed.readonly === "boolean") metadata.readonly = parsed.readonly;
    if (typeof parsed.background === "boolean") metadata.background = parsed.background;
    if (Array.isArray(parsed.tags)) metadata.tags = parsed.tags.filter((t: unknown) => typeof t === "string");
  }

  if (!metadata.id && metadata.name) {
    metadata.id = metadata.name;
  }
  metadata.type = metadata.type ?? "rule";
  metadata.description = metadata.description ?? "";

  return { metadata, content: content ?? "" };
}

export type CanonicalType =
  | "rules"
  | "agents"
  | "skills"
  | "commands"
  | "prompts"
  | "github-agents";

interface ReaderConfig {
  type: CanonicalFile["type"];
  dir: string;
  strategy: "glob" | "subdirectory";
}

const READER_CONFIGS: Record<CanonicalType, ReaderConfig> = {
  rules: { type: "rule", dir: "rules", strategy: "glob" },
  agents: { type: "agent", dir: "agents", strategy: "glob" },
  skills: { type: "skill", dir: "skills", strategy: "subdirectory" },
  commands: { type: "command", dir: "commands", strategy: "glob" },
  prompts: { type: "prompt", dir: "prompts", strategy: "glob" },
  "github-agents": { type: "github-agent", dir: "github-agents", strategy: "glob" },
};

/**
 * Read all `.md` files in a directory (recursively) and parse frontmatter.
 * Per-file errors are caught and the file is skipped, so a single corrupt
 * file does not prevent reading the rest of the directory.
 */
async function readGlobMd(baseDir: string, fileType: CanonicalFile["type"]): Promise<CanonicalFile[]> {
  let entries: string[];
  try {
    const all = await readdir(baseDir, { recursive: true });
    entries = all.filter((f) => f.endsWith(".md")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }

  const results = await Promise.all(
    entries.map(async (relPath) => {
      const fullPath = join(baseDir, relPath);
      try {
        const stats = await lstat(fullPath);
        if (stats.isSymbolicLink()) {
          return null;
        }
        const rawContent = await readFile(fullPath, "utf-8");
        const { metadata, content } = parseFrontmatter(rawContent);
        const id = metadata.id || metadata.name || relPath.replace(/\.md$/, "").replace(/\//g, "-");
        return {
          id,
          type: fileType,
          description: metadata.description ?? "",
          scope: metadata.scope,
          model: metadata.model,
          protected: metadata.protected,
          readonly: metadata.readonly,
          background: metadata.background,
          tags: metadata.tags,
          content,
          rawContent,
          sourcePath: fullPath,
        };
      } catch {
        // Per-file error handling: skip this file but continue reading the rest
        return null;
      }
    }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Read skill content from subdirectories (`{baseDir}/{skillName}/SKILL.md`).
 * Each skill is a directory containing a `SKILL.md` file with frontmatter.
 * Symlinks are skipped; missing `SKILL.md` files cause the directory to be skipped.
 */
async function readSkillSubdirs(baseDir: string): Promise<CanonicalFile[]> {
  let dirents: { name: string; isDirectory: () => boolean }[];
  try {
    dirents = (await readdir(baseDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }

  const entries = await Promise.all(
    dirents
      .filter((d) => d.isDirectory())
      .map(async (dir) => {
        const skillPath = join(baseDir, dir.name, "SKILL.md");
        try {
          const skillStats = await lstat(skillPath);
          if (skillStats.isSymbolicLink()) {
            return null;
          }
          const rawContent = await readFile(skillPath, "utf-8");
          const { metadata, content } = parseFrontmatter(rawContent);
          const id = metadata.name ?? metadata.id ?? dir.name;
          return {
            id,
            type: "skill" as const,
            description: metadata.description ?? "",
            protected: metadata.protected,
            tags: metadata.tags,
            content,
            rawContent,
            sourcePath: skillPath,
          };
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          return null;
        }
      }),
  );

  return entries.filter((e): e is NonNullable<typeof e> => e !== null);
}

/**
 * Read all canonical files of a given type from the `.agents/` directory.
 *
 * Returns parsed `CanonicalFile` objects with frontmatter metadata and body content.
 * Skills use subdirectory strategy (`skills/{name}/SKILL.md`); all others use glob
 * strategy (flat `.md` files in the type directory).
 */
export async function readCanonicalFiles(
  agentsDir: string,
  type: CanonicalType,
): Promise<CanonicalFile[]> {
  const config = READER_CONFIGS[type];
  const baseDir = join(agentsDir, config.dir);
  return config.strategy === "subdirectory"
    ? readSkillSubdirs(baseDir)
    : readGlobMd(baseDir, config.type);
}
