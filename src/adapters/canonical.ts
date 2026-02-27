import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { glob } from "glob";
import { parse as parseYaml } from "yaml";
import type { CanonicalFile, CanonicalMetadata } from "../types.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

function parseFrontmatter(rawContent: string): {
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
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        metadata[key] = value;
      }
    }
  }

  if (!metadata.id && metadata.name) {
    metadata.id = metadata.name;
  }
  metadata.type = (metadata.type ?? "rule") as CanonicalMetadata["type"];
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

export async function readCanonicalFiles(
  agentsDir: string,
  type: CanonicalType,
): Promise<CanonicalFile[]> {
  const results: CanonicalFile[] = [];

  switch (type) {
    case "rules": {
      let files: string[] = [];
      try {
        files = await glob("**/*.md", {
          cwd: join(agentsDir, "rules"),
          nodir: true,
        });
      } catch { break; }
      const ruleEntries = await Promise.all(
        files.map(async (relPath) => {
          const fullPath = join(agentsDir, "rules", relPath);
          const rawContent = await readFile(fullPath, "utf-8");
          const { metadata, content } = parseFrontmatter(rawContent);
          const id = metadata.id || relPath.replace(/\.md$/, "").replace(/\//g, "-");
          return {
            id,
            type: "rule" as const,
            description: metadata.description ?? "",
            scope: metadata.scope,
            content,
            rawContent,
            sourcePath: fullPath,
          };
        })
      );
      results.push(...ruleEntries);
      break;
    }

    case "agents": {
      let files: string[] = [];
      try {
        files = await glob("**/*.md", {
          cwd: join(agentsDir, "agents"),
          nodir: true,
        });
      } catch { break; }
      const agentEntries = await Promise.all(
        files.map(async (relPath) => {
          const fullPath = join(agentsDir, "agents", relPath);
          const rawContent = await readFile(fullPath, "utf-8");
          const { metadata, content } = parseFrontmatter(rawContent);
          const id = metadata.id ?? metadata.name ?? relPath.replace(/\.md$/, "");
          return {
            id,
            type: "agent" as const,
            description: metadata.description ?? "",
            model: metadata.model,
            content,
            rawContent,
            sourcePath: fullPath,
          };
        })
      );
      results.push(...agentEntries);
      break;
    }

    case "skills": {
      let skillDirs: { name: string; isDirectory: () => boolean }[] = [];
      try {
        skillDirs = await readdir(join(agentsDir, "skills"), {
          withFileTypes: true,
        });
      } catch {
        break;
      }
      const dirs = skillDirs.filter((d) => d.isDirectory());
      const skillEntries = await Promise.all(
        dirs.map(async (dir) => {
          const skillPath = join(agentsDir, "skills", dir.name, "SKILL.md");
          try {
            const rawContent = await readFile(skillPath, "utf-8");
            const { metadata, content } = parseFrontmatter(rawContent);
            const id = metadata.name ?? metadata.id ?? dir.name;
            return {
              id,
              type: "skill" as const,
              description: metadata.description ?? "",
              content,
              rawContent,
              sourcePath: skillPath,
            };
          } catch (err) {
            const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
            if (code !== "ENOENT") {
              console.warn(chalk.yellow(`  Warning: Could not read SKILL.md in ${dir.name}: ${err instanceof Error ? err.message : String(err)}`));
            }
            return null;
          }
        })
      );
      results.push(...skillEntries.filter((e): e is NonNullable<typeof e> => e !== null));
      break;
    }

    case "commands": {
      let files: string[] = [];
      try {
        files = await glob("**/*.md", {
          cwd: join(agentsDir, "commands"),
          nodir: true,
        });
      } catch { break; }
      const cmdEntries = await Promise.all(
        files.map(async (relPath) => {
          const fullPath = join(agentsDir, "commands", relPath);
          const rawContent = await readFile(fullPath, "utf-8");
          const { metadata, content } = parseFrontmatter(rawContent);
          const id = metadata.id || relPath.replace(/\.md$/, "");
          return {
            id,
            type: "command" as const,
            description: metadata.description ?? "",
            content,
            rawContent,
            sourcePath: fullPath,
          };
        })
      );
      results.push(...cmdEntries);
      break;
    }

    case "prompts": {
      const dir = join(agentsDir, "prompts");
      try {
        const files = await glob("**/*.md", { cwd: dir, nodir: true });
        const promptEntries = await Promise.all(
          files.map(async (relPath) => {
            const fullPath = join(dir, relPath);
            const rawContent = await readFile(fullPath, "utf-8");
            const { metadata, content } = parseFrontmatter(rawContent);
            const id = metadata.id ?? metadata.name ?? relPath.replace(/\.md$/, "");
            return {
              id,
              type: "prompt" as const,
              description: metadata.description ?? "",
              content,
              rawContent,
              sourcePath: fullPath,
            };
          })
        );
        results.push(...promptEntries);
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read prompts: ${err instanceof Error ? err.message : String(err)}`));
      }
      break;
    }

    case "github-agents": {
      const dir = join(agentsDir, "github-agents");
      try {
        const files = await glob("**/*.md", { cwd: dir, nodir: true });
        const ghEntries = await Promise.all(
          files.map(async (relPath) => {
            const fullPath = join(dir, relPath);
            const rawContent = await readFile(fullPath, "utf-8");
            const { metadata, content } = parseFrontmatter(rawContent);
            const id = metadata.id ?? metadata.name ?? relPath.replace(/\.md$/, "");
            return {
              id,
              type: "github-agent" as const,
              description: metadata.description ?? "",
              content,
              rawContent,
              sourcePath: fullPath,
            };
          })
        );
        results.push(...ghEntries);
      } catch (err) {
        console.warn(chalk.yellow(`  Warning: Could not read github-agents: ${err instanceof Error ? err.message : String(err)}`));
      }
      break;
    }
  }

  return results;
}
