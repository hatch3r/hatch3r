import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { getAdapter } from "../../adapters/index.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { AGENTS_DIR, HATCH3R_PREFIX } from "../../types.js";
import { CANONICAL_AGENTS_MD } from "../shared/agentsContent.js";
import { HATCH3R_VERSION } from "../../version.js";
import {
  printBanner,
  createSpinner,
  printBox,
  error as logError,
  info,
  step,
  label,
} from "../shared/ui.js";
import { findPackageRoot } from "../shared/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);
const CONTENT_DIRS = ["agents", "commands", "rules", "skills", "prompts", "github-agents", "mcp", "hooks"];

async function copyHatch3rFiles(
  srcDir: string,
  destDir: string,
  insideHatch3rDir = false,
): Promise<string[]> {
  const copied: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      const subCopied = await copyHatch3rFiles(
        srcPath,
        destPath,
        entry.name.startsWith(HATCH3R_PREFIX),
      );
      copied.push(...subCopied.map((p) => join(entry.name, p)));
    } else if (entry.name.startsWith(HATCH3R_PREFIX) || insideHatch3rDir) {
      await mkdir(dirname(destPath), { recursive: true });
      await cp(srcPath, destPath, { force: true });
      copied.push(entry.name);
    }
  }

  return copied;
}

export async function updateCommand(opts: { backup?: boolean } = {}): Promise<void> {
  printBanner(true);

  const rootDir = process.cwd();
  const agentsDir = join(rootDir, AGENTS_DIR);
  const manifest = await readManifest(rootDir);

  if (!manifest) {
    logError("No .agents/hatch.json found.");
    console.log(chalk.dim("  Run `npx hatch3r init` to set up your project first.\n"));
    process.exit(1);
  }

  const m = manifest;
  const currentVersion = m.hatch3rVersion;
  const isUpToDate = currentVersion === HATCH3R_VERSION;

  if (isUpToDate) {
    info(`Already at hatch3r v${HATCH3R_VERSION}`);
  } else {
    info(`Updating from v${currentVersion} to v${HATCH3R_VERSION}`);
  }
  console.log();

  const totalSteps = 3;

  const s1 = createSpinner(step(1, totalSteps, "Updating canonical files..."));
  s1.start();
  const copied: string[] = [];
  for (const dir of CONTENT_DIRS) {
    const srcDir = join(CONTENT_ROOT, dir);
    try {
      const dirCopied = await copyHatch3rFiles(srcDir, join(agentsDir, dir));
      copied.push(...dirCopied.map((p) => join(dir, p)));
    } catch {
      // source dir may not exist
    }
  }
  await writeFile(join(agentsDir, "AGENTS.md"), CANONICAL_AGENTS_MD, "utf-8");

  s1.succeed(step(1, totalSteps, `Updated ${copied.length} canonical files`));

  const s2 = createSpinner(step(2, totalSteps, "Re-syncing adapter output..."));
  s2.start();
  for (const tool of m.tools) {
    const adapter = getAdapter(tool);
    try {
      const outputs = await adapter.generate(agentsDir, m);
      for (const out of outputs) {
        const fullPath = join(rootDir, out.path);
        if (out.managedContent) {
          await safeWriteFile(fullPath, out.content, {
            managedContent: out.managedContent,
            backup: opts.backup ?? true,
          });
        } else {
          await mkdir(dirname(fullPath), { recursive: true });
          try {
            const existing = await readFile(fullPath, "utf-8");
            if (existing !== out.content) {
              await writeFile(fullPath, out.content, "utf-8");
            }
          } catch {
            await writeFile(fullPath, out.content, "utf-8");
          }
        }
      }
    } catch (err) {
      s2.fail(step(2, totalSteps, `Failed to generate ${tool} output`));
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
  s2.succeed(step(2, totalSteps, `Re-synced ${m.tools.length} tool(s)`));

  const s3 = createSpinner(step(3, totalSteps, "Writing manifest..."));
  s3.start();
  m.hatch3rVersion = HATCH3R_VERSION;
  await writeManifest(rootDir, m);
  s3.succeed(step(3, totalSteps, "Manifest updated"));

  console.log();
  printBox("Update complete", [
    label("Files", `${copied.length} canonical files updated`),
    label("Tools", `${m.tools.length} tool(s) re-synced`),
    label("Version", `v${HATCH3R_VERSION}`),
  ], "success");
}
