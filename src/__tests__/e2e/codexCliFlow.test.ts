import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveToolOutputs, removeManagedFilesForPaths } from "../../archive/index.js";
import { TOOLBOX_CLI_TOOLS } from "../../cliTools/registry.js";
import type { HatchManifest } from "../../types.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli", "index.js");
const HAS_DIST = existsSync(CLI_PATH);

if (process.env.CI && !HAS_DIST) {
  throw new Error(
    "dist/cli/index.js missing in CI — build must precede the Codex lifecycle E2E suite",
  );
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(
  args: string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {},
): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: process.platform === "win32" ? 180_000 : 90_000,
    env: {
      ...process.env,
      HATCH3R_LOCK: "0",
      HATCH3R_NO_UPDATE_CHECK: "1",
      NODE_NO_WARNINGS: "1",
      ...envOverrides,
    },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`,
    exitCode: result.status ?? 1,
  };
}

function jsonPayload<T>(result: CliResult): T {
  expect(result.exitCode, result.stderr).toBe(0);
  const start = result.stdout.indexOf("{");
  expect(start, result.stdout).toBeGreaterThanOrEqual(0);
  return JSON.parse(result.stdout.slice(start).trim()) as T;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function readManifest(root: string): Promise<HatchManifest> {
  return JSON.parse(await readFile(join(root, ".hatch3r", "hatch.json"), "utf-8")) as HatchManifest;
}

async function writeManifest(root: string, manifest: HatchManifest): Promise<void> {
  await writeFile(
    join(root, ".hatch3r", "hatch.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function bytesFor(root: string, paths: readonly string[]): Promise<Map<string, string>> {
  return new Map(await Promise.all([...paths].sort().map(async (path) => [
    path,
    (await readFile(join(root, path))).toString("base64"),
  ] as const)));
}

describe.skipIf(!HAS_DIST)("Codex built-CLI lifecycle", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("emits valid full-preset CTAs, MCP launch guidance, and the 34-tool toolbox", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-cli-full-"));
    const secretMarker = "must-not-appear-in-hatch3r-output";
    const init = runCli([
      "init",
      "--yes",
      "--tools", "codex",
      "--preset", "full",
      "--cli-tools", "all",
      "--mcp",
      "--no-banner",
    ], root, { GITHUB_PAT: secretMarker });

    expect(init.exitCode, init.stderr).toBe(0);
    const normalizedOutput = init.stdout
      .replace(/[│╭╮╰╯─]+/g, " ")
      .replace(/\s+/g, " ");
    expect(init.stdout).not.toContain(secretMarker);
    expect(init.stdout).not.toContain("/hatch3r-");
    expect(init.stdout).not.toMatch(/\$hatch3r-(?!command-)/);

    const expectedCtas = [
      "spec",
      "roadmap",
      "feature-plan",
      "quick-change",
      "project-spec",
      "create",
    ];
    for (const id of expectedCtas) {
      const invocation = `$hatch3r-command-${id}`;
      expect(init.stdout).toContain(invocation);
      expect(await exists(join(
        root,
        ".agents",
        "skills",
        invocation.slice(1),
        "SKILL.md",
      ))).toBe(true);
    }
    expect(init.stdout).not.toContain("$hatch3r-command-codebase-map");

    const sourceNeedle = process.platform === "win32"
      ? "Get-Content .env.mcp"
      : "source .env.mcp";
    const sourceIndex = init.stdout.indexOf(sourceNeedle);
    const restartIndex = init.stdout.indexOf("Restart your editor");
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(restartIndex).toBeGreaterThan(sourceIndex);
    expect(normalizedOutput).toMatch(
      /Codex:.*Source \.env\.mcp.*platform-appropriate.*before starting or restarting Codex/i,
    );

    const toolboxPath = join(
      root,
      ".agents",
      "skills",
      "hatch3r-cli-toolbox",
      "SKILL.md",
    );
    const toolbox = await readFile(toolboxPath, "utf-8");
    expect(TOOLBOX_CLI_TOOLS).toHaveLength(34);
    for (const id of TOOLBOX_CLI_TOOLS) {
      expect(toolbox).toContain(`### ${id}`);
    }
    expect(await exists(join(root, ".codex", "skills"))).toBe(false);

    const manifest = await readManifest(root);
    expect(manifest.cliTools).toMatchObject({ enabled: true });
    expect(manifest.cliTools?.selected).toHaveLength(39);
    expect(await readFile(join(root, ".env.mcp"), "utf-8")).not.toContain(secretMarker);
  }, process.platform === "win32" ? 300_000 : 180_000);

  it("matches the brownfield codebase-map CTA to its emitted command skill", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-cli-brownfield-"));
    await writeFile(join(root, "tsconfig.json"), "{}\n", "utf-8");

    const init = runCli([
      "init",
      "--yes",
      "--tools", "codex",
      "--preset", "full",
      "--project-type", "brownfield",
      "--no-banner",
    ], root);

    expect(init.exitCode, init.stderr).toBe(0);
    const invocation = "$hatch3r-command-codebase-map";
    expect(init.stdout).toContain(invocation);
    expect(init.stdout).not.toContain("$hatch3r-command-project-spec");
    expect(await exists(join(
      root,
      ".agents",
      "skills",
      invocation.slice(1),
      "SKILL.md",
    ))).toBe(true);
  }, process.platform === "win32" ? 300_000 : 180_000);

  it("runs init through clean while preserving Codex co-tenants", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-cli-flow-"));
    const userFiles = new Map<string, string>([
      [".agents/skills/personal/SKILL.md", "personal skill\n"],
      [".agents/skills/vendor/SKILL.md", "third-party skill\n"],
      [".codex/agents/personal.toml", 'name = "personal"\n'],
      [".codex/config.toml", 'model = "gpt-5"\n\n[mcp_servers.personal]\nurl = "https://example.test/mcp"\n'],
      ["AGENTS.md", "# User root instructions\n\nKeep this paragraph.\n"],
      ["packages/app/AGENTS.md", "# Nested user instructions\r\n\r\nPreserve CRLF.\r\n"],
      ["packages/app/nested/AGENTS.override.md", "# Third-party nested override\n"],
    ]);
    for (const [path, content] of userFiles) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await mkdir(join(root, ".codex"), { recursive: true });
    const userHooksContent = `${JSON.stringify({
      description: "user hooks",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "node user-stop.mjs" }] }],
      },
    }, null, 2)}\n`;
    await writeFile(join(root, ".codex", "hooks.json"), userHooksContent);

    const init = jsonPayload<{ snapshotSessionId: string }>(runCli([
      "init",
      "--yes",
      "--tools", "codex",
      "--preset", "minimal",
      "--no-mcp",
      "--no-cli-tools",
      "--no-banner",
      "--quiet",
      "--format", "json",
    ], root));
    expect(init.snapshotSessionId).toMatch(/^init-/);
    expect(await exists(join(root, ".codex", "skills"))).toBe(false);

    const configured = await readManifest(root);
    configured.features.mcp = true;
    configured.mcp.servers = ["context7"];
    await writeManifest(root, configured);
    jsonPayload(runCli(["sync", "--quiet", "--format", "json"], root));

    const synced = await readManifest(root);
    const codexPaths = synced.managedFilesByAdapter?.codex ?? [];
    expect(codexPaths).toContain("AGENTS.md");
    expect(codexPaths).toContain(".codex/config.toml");
    expect(codexPaths).toContain(".codex/hooks.json");
    expect(codexPaths.some((path) => path.startsWith(".agents/skills/hatch3r-"))).toBe(true);
    expect(codexPaths.some((path) => path.startsWith(".codex/agents/hatch3r-"))).toBe(true);
    expect(codexPaths.some((path) => path.startsWith(".codex/skills/"))).toBe(false);
    const provenance = JSON.parse(
      await readFile(join(root, ".hatch3r", "provenance.json"), "utf-8"),
    ) as { lastCommand: string; outputs: Array<{ path: string; adapter: string; sourceFiles: string[] }> };
    expect(provenance.lastCommand).toBe("sync");
    expect(provenance.outputs.find((entry) => entry.path.includes("hatch3r-bug-fix/SKILL.md")))
      .toMatchObject({ adapter: "codex", sourceFiles: expect.arrayContaining([expect.stringContaining("SKILL.md")]) });

    const beforeRepeat = await bytesFor(root, codexPaths);
    jsonPayload(runCli(["sync", "--quiet", "--format", "json"], root));
    expect(await bytesFor(root, codexPaths)).toEqual(beforeRepeat);

    const skillPath = ".agents/skills/hatch3r-bug-fix/SKILL.md";
    const originalSkill = await readFile(join(root, skillPath), "utf-8");
    await mkdir(join(root, ".hatch3r", "skills"), { recursive: true });
    await writeFile(
      join(root, ".hatch3r", "skills", "hatch3r-bug-fix.customize.md"),
      "Use the CLI lifecycle regression checklist.",
    );
    const update = jsonPayload<{ snapshotSessionId: string }>(runCli([
      "update", "--yes", "--offline", "--quiet", "--format", "json",
    ], root));
    expect(update.snapshotSessionId).toMatch(/^update-/);
    expect(await readFile(join(root, skillPath), "utf-8")).toContain(
      "CLI lifecycle regression checklist",
    );

    jsonPayload(runCli([
      "rollback", "--session", update.snapshotSessionId, "--yes", "--quiet", "--format", "json",
    ], root));
    expect(await readFile(join(root, skillPath), "utf-8")).toBe(originalSkill);

    await writeFile(
      join(root, ".hatch3r", "skills", "hatch3r-bug-fix.customize.yaml"),
      "enabled: false\n",
    );
    jsonPayload(runCli(["sync", "--quiet", "--format", "json"], root));
    expect(await exists(join(root, skillPath))).toBe(false);
    const afterDisableProvenance = JSON.parse(
      await readFile(join(root, ".hatch3r", "provenance.json"), "utf-8"),
    ) as { outputs: Array<{ path: string }> };
    expect(afterDisableProvenance.outputs.some((entry) => entry.path === skillPath)).toBe(false);

    const removeCodex = await readManifest(root);
    const recordedCodexPaths = removeCodex.managedFilesByAdapter?.codex ?? [];
    const archivedCodex = await archiveToolOutputs(root, "codex", {
      recordedPaths: recordedCodexPaths,
    });
    expect(archivedCodex.archivedFiles.length).toBeGreaterThan(0);
    removeManagedFilesForPaths(removeCodex, archivedCodex.archivedFiles);
    if (removeCodex.managedFilesByAdapter) delete removeCodex.managedFilesByAdapter.codex;
    removeCodex.tools = ["cursor"];
    await writeManifest(root, removeCodex);
    jsonPayload(runCli(["sync", "--quiet", "--format", "json"], root));
    expect(await exists(join(root, ".agents", "skills", "hatch3r-a11y-audit"))).toBe(false);
    expect(await exists(join(root, ".codex", "agents", "hatch3r-reviewer.toml"))).toBe(false);
    expect(await exists(join(root, ".hatch3r", "codex-support"))).toBe(false);
    expect(await exists(join(root, ".codex", "skills"))).toBe(false);

    expect(await readFile(join(root, ".agents/skills/personal/SKILL.md"), "utf-8"))
      .toBe(userFiles.get(".agents/skills/personal/SKILL.md"));
    expect(await readFile(join(root, ".agents/skills/vendor/SKILL.md"), "utf-8"))
      .toBe(userFiles.get(".agents/skills/vendor/SKILL.md"));
    expect(await readFile(join(root, ".codex/agents/personal.toml"), "utf-8"))
      .toBe(userFiles.get(".codex/agents/personal.toml"));
    expect(await readFile(join(root, ".codex/config.toml"), "utf-8"))
      .toBe(userFiles.get(".codex/config.toml"));
    expect(await readFile(join(root, "AGENTS.md"), "utf-8"))
      .toBe(userFiles.get("AGENTS.md"));
    expect(await readFile(join(root, "packages/app/AGENTS.md"), "utf-8"))
      .toBe(userFiles.get("packages/app/AGENTS.md"));
    expect(await readFile(join(root, "packages/app/nested/AGENTS.override.md"), "utf-8"))
      .toBe(userFiles.get("packages/app/nested/AGENTS.override.md"));
    const hooksAfterRemoval = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf-8")) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(hooksAfterRemoval.hooks.Stop[0]?.hooks[0]?.command).toBe("node user-stop.mjs");

    jsonPayload(runCli(["clean", "--yes", "--quiet", "--format", "json"], root));
    expect(await exists(join(root, ".hatch3r", "hatch.json"))).toBe(false);
    expect(await readFile(join(root, ".agents/skills/personal/SKILL.md"), "utf-8"))
      .toBe(userFiles.get(".agents/skills/personal/SKILL.md"));
    expect(await readFile(join(root, ".agents/skills/vendor/SKILL.md"), "utf-8"))
      .toBe(userFiles.get(".agents/skills/vendor/SKILL.md"));
    expect(await readFile(join(root, ".codex/agents/personal.toml"), "utf-8"))
      .toBe(userFiles.get(".codex/agents/personal.toml"));
    expect(await readFile(join(root, ".codex/config.toml"), "utf-8"))
      .toBe(userFiles.get(".codex/config.toml"));
    expect(await readFile(join(root, "AGENTS.md"), "utf-8"))
      .toBe(userFiles.get("AGENTS.md"));
    expect(await readFile(join(root, "packages/app/AGENTS.md"), "utf-8"))
      .toBe(userFiles.get("packages/app/AGENTS.md"));
    expect(await readFile(join(root, "packages/app/nested/AGENTS.override.md"), "utf-8"))
      .toBe(userFiles.get("packages/app/nested/AGENTS.override.md"));
    expect(await readFile(join(root, ".codex/hooks.json"), "utf-8")).toBe(userHooksContent);
  }, process.platform === "win32" ? 300_000 : 180_000);
});
