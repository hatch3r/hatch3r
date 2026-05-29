import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../../adapters/canonical.js";
import { verbose } from "./ui.js";

/**
 * D1-SA1.7-F9 (Cycle 10 Wave 4, D1/CQ8): shared filesystem readers extracted
 * from the former monolithic `agentsContent.ts`. Both the bridge-orchestration
 * generator and the AGENTS.md generators read the canonical agents/skills/
 * commands directories with identical semantics, so the readers live here to
 * keep each concern module single-purpose without duplicating the disk-walk
 * logic. No behavior change — the function bodies are moved verbatim.
 */

/**
 * Record an agentsContent-probe failure: emit a verbose() line to stderr
 * (visible only with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract.
 */
export function recordAgentsContentProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`agentsContent: ${operation} — ${message}`);
}

export interface DirFile {
  name: string;
  content: string;
}

export async function readDirFiles(dir: string): Promise<DirFile[]> {
  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    return Promise.all(
      mdFiles.map(async (name) => ({
        name,
        content: await readFile(join(dir, name), "utf-8"),
      })),
    );
  } catch (err) {
    recordAgentsContentProbeFailure(`readDirFiles(${dir}) → [] — directory missing`, err);
    return [];
  }
}

/**
 * Extract a condensed checklist from skill content by pulling numbered lists
 * and heading structure (max ~20 lines per skill to keep token count manageable).
 */
export function extractSkillChecklist(content: string): string | undefined {
  const lines = content.split("\n");
  const checklist: string[] = [];
  let inSteps = false;

  for (const line of lines) {
    // Start capturing at headings containing "steps", "protocol", "workflow", "checklist", or numbered procedure
    if (/^#{1,3}\s+.*(step|protocol|workflow|checklist|procedure|implementation)/i.test(line)) {
      inSteps = true;
      continue;
    }
    // Stop at the next major heading that isn't a sub-step
    if (inSteps && /^#{1,2}\s+/.test(line) && !/step|phase/i.test(line)) {
      break;
    }
    if (inSteps && (line.match(/^\d+\.\s/) || line.match(/^-\s/) || line.match(/^\s+\d+\.\s/) || line.match(/^\s+-\s/))) {
      checklist.push(line);
      if (checklist.length >= 20) break;
    }
  }

  return checklist.length > 0 ? checklist.join("\n") : undefined;
}

export async function readSkillDirs(dir: string): Promise<{ id: string; description: string; checklist?: string }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const skills: { id: string; description: string; checklist?: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(dir, entry.name, "SKILL.md"), "utf-8");
        const { metadata, content } = parseFrontmatter(raw);
        skills.push({
          id: metadata.id || metadata.name || entry.name,
          description: metadata.description ?? "",
          checklist: extractSkillChecklist(content),
        });
      } catch (err) {
        recordAgentsContentProbeFailure(
          `readSkillDirs: readFile(${dir}/${entry.name}/SKILL.md) skipped`,
          err,
        );
      }
    }
    return skills.sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    recordAgentsContentProbeFailure(
      `readSkillDirs(${dir}) → [] — directory missing`,
      err,
    );
    return [];
  }
}
