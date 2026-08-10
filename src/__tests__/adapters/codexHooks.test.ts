import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { HookDefinition } from "../../hooks/types.js";
import {
  codexHookCommand,
  codexHookCommandWindows,
  mergeCodexHooksDocument,
  parseCodexHooksJson,
  projectCodexHooks,
  readCodexHooksPreflight,
  removeCodexOwnedHookEntries,
} from "../../adapters/codexHooks.js";
import {
  mergeCodexTomlManagedRegion,
  parseCodexToml,
  preflightCodexToml,
  readCodexTomlPreflight,
} from "../../adapters/codexToml.js";
import { LEGACY_SESSION_START_HOOK_COMMAND } from "../helpers/codexLegacyHookFixture.js";

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hatch3r-codex-hooks-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function snapshotTree(root: string): Promise<Array<[string, string]>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(files.map(async (path) => [
    relative(root, path).replace(/\\/g, "/"),
    (await readFile(path)).toString("base64"),
  ]));
}

const sessionHook: HookDefinition = {
  id: "session-start-learnings",
  event: "session-start",
  agent: "learnings-loader",
  description: "Load learnings",
  sourcePath: "/canonical/hooks/hatch3r-session-start-learnings.md",
};
const unsupportedHook: HookDefinition = {
  id: "pre-commit-lint-fixer",
  event: "pre-commit",
  agent: "lint-fixer",
  description: "Lint",
};

describe("Codex hooks projection", () => {
  it("emits fresh hooks.json, a managed support script, trust metadata, and explicit unsupported warnings", async () => {
    const projection = await projectCodexHooks(
      tempRoot(),
      [sessionHook, unsupportedHook],
      preflightCodexToml(""),
    );
    expect(projection.route).toBe("hooks-json");
    expect(projection.outputs.map((output) => output.path)).toEqual([
      ".codex/hooks.json",
      ".codex/hatch3r/hooks/hatch3r-session-start-learnings.mjs",
    ]);
    const doc = parseCodexHooksJson(projection.outputs[0].content);
    const handler = doc.hooks.SessionStart?.[0].hooks[0];
    expect(handler).toMatchObject({
      type: "command",
      timeout: 5,
      statusMessage: "hatch3r:session-start-learnings",
      additionalContextLimit: 4096,
      async: false,
    });
    expect(handler?.commandWindows).toBe(handler?.command);
    expect(handler?.command).not.toMatch(/["'&|<>^%!$`()\\;*?\[\]{}]/);
    expect(handler?.command).toBe(codexHookCommand(sessionHook.id));
    expect(handler?.command).toMatch(/^echo [A-Za-z0-9 .,:-]+$/);
    expect(handler?.command).not.toMatch(/(?:\.\.|existsSync|pathToFileURL|import\(|\.codex|hatch3r\/hooks)/);
    expect(projection.outputs[1].managedContent).toContain("hatch3r-learnings-loader custom subagent");
    expect(projection.outputs[0].sourceFiles).toEqual([sessionHook.sourcePath]);
    expect(projection.outputs[1].sourceFiles).toEqual([sessionHook.sourcePath]);
    expect(projection.sourceFiles).toEqual([sessionHook.sourcePath]);
    expect(projection.warnings.join("\n")).toContain("pre-commit");
    expect(projection.warnings.join("\n")).toContain("/hooks");
  });

  it.each([
    "session-start&whoami",
    "session-start%PATH%",
    "session-start$(whoami)",
    "session-start;whoami",
  ])("rejects shell syntax in a hook id before constructing command %j", (id) => {
    expect(() => codexHookCommand(id)).toThrow("Unsafe Codex hook id");
    expect(() => codexHookCommandWindows(id)).toThrow("Unsafe Codex hook id");
  });

  it("routes into established inline hooks and preserves an existing hooks file", async () => {
    const root = tempRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex/hooks.json"), '{"description":"user","hooks":{}}\n');
    const config = preflightCodexToml('[[hooks."Stop"]]\nhooks = []\n');
    const projection = await projectCodexHooks(root, [sessionHook], config);
    expect(projection.route).toBe("inline-config");
    expect(projection.outputs.some((output) => output.path === ".codex/hooks.json")).toBe(false);
    expect(projection.sourceFiles).toEqual([sessionHook.sourcePath]);
    expect(projection.warnings.join("\n")).toContain("Both .codex/hooks.json");
    expect(() => parseCodexToml(mergeCodexTomlManagedRegion(config.content, projection.inlineToml))).not.toThrow();
  });

  it("uses explicit empty provenance when an in-memory hook has no canonical source", async () => {
    const { sourcePath: _sourcePath, ...hookWithoutSource } = sessionHook;
    const projection = await projectCodexHooks(
      tempRoot(),
      [hookWithoutSource],
      preflightCodexToml(""),
    );
    expect(projection.sourceFiles).toEqual([]);
    expect(projection.outputs.every((output) => output.sourceFiles?.length === 0)).toBe(true);
  });

  it("preserves user group and handler order, replacing owned handlers at the end", () => {
    const command = codexHookCommand(sessionHook.id);
    const existing = parseCodexHooksJson(JSON.stringify({
      description: "user description",
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: "user-one" },
          {
            type: "command", command, commandWindows: command, timeout: 5,
            statusMessage: "hatch3r:session-start-learnings", additionalContextLimit: 4096, async: false,
          },
          { type: "command", command: "user-two" },
        ] }],
      },
    }));
    const replacement = {
      type: "command" as const,
      command,
      commandWindows: command,
      timeout: 5,
      statusMessage: "hatch3r:session-start-learnings",
      additionalContextLimit: 4096,
      async: false,
    };
    const merged = mergeCodexHooksDocument(existing, [{ event: "SessionStart", group: { hooks: [replacement] } }]);
    expect(merged.description).toBe("user description");
    expect(merged.hooks.SessionStart?.[0].hooks.map((handler) => handler.command)).toEqual(["user-one", "user-two"]);
    expect(merged.hooks.SessionStart?.[1].hooks[0]).toEqual(replacement);
  });

  it("upgrades the exact prior Hatcher command template and stays idempotent", async () => {
    const root = tempRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex/hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{
      type: "command",
      command: LEGACY_SESSION_START_HOOK_COMMAND,
      commandWindows: LEGACY_SESSION_START_HOOK_COMMAND,
      statusMessage: "hatch3r:session-start-learnings",
    }] }] } }));

    const first = await projectCodexHooks(root, [sessionHook], preflightCodexToml(""));
    const firstContent = first.outputs.find((output) => output.path === ".codex/hooks.json")!.content;
    const firstHandler = parseCodexHooksJson(firstContent).hooks.SessionStart?.[0]?.hooks[0];
    expect(firstHandler).toMatchObject({
      command: codexHookCommand(sessionHook.id),
      commandWindows: codexHookCommandWindows(sessionHook.id),
      statusMessage: "hatch3r:session-start-learnings",
    });
    expect(firstContent).not.toContain(LEGACY_SESSION_START_HOOK_COMMAND);

    await writeFile(join(root, ".codex/hooks.json"), firstContent);
    const second = await projectCodexHooks(root, [sessionHook], preflightCodexToml(""));
    expect(second.outputs.find((output) => output.path === ".codex/hooks.json")!.content)
      .toBe(firstContent);
  });

  it("rejects and preserves a minimally changed prior command as an ownership collision", async () => {
    const root = tempRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    const hooksPath = join(root, ".codex/hooks.json");
    const content = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{
      type: "command",
      command: `${LEGACY_SESSION_START_HOOK_COMMAND} `,
      commandWindows: LEGACY_SESSION_START_HOOK_COMMAND,
      statusMessage: "hatch3r:session-start-learnings",
    }] }] } });
    await writeFile(hooksPath, content);

    await expect(projectCodexHooks(root, [sessionHook], preflightCodexToml("")))
      .rejects.toThrow("ownership collision");
    expect(await readFile(hooksPath, "utf-8")).toBe(content);
  });

  it("removes only exact hatch3r handlers and preserves user hooks", () => {
    const command = codexHookCommand(sessionHook.id);
    const content = JSON.stringify({ hooks: { SessionStart: [
      { hooks: [{ type: "command", command: "user" }] },
      { hooks: [{
        type: "command", command, commandWindows: command, timeout: 5,
        statusMessage: "hatch3r:session-start-learnings", additionalContextLimit: 4096, async: false,
      }] },
    ] } });
    const cleaned = parseCodexHooksJson(removeCodexOwnedHookEntries(content)!);
    expect(cleaned.hooks.SessionStart).toHaveLength(1);
    expect(cleaned.hooks.SessionStart?.[0].hooks[0]).toMatchObject({ type: "command", command: "user" });
  });

  it("removes the exact prior Hatcher handler while preserving foreign hooks", () => {
    const content = JSON.stringify({ hooks: { SessionStart: [
      { hooks: [{ type: "command", command: "user" }] },
      { hooks: [{
        type: "command",
        command: LEGACY_SESSION_START_HOOK_COMMAND,
        commandWindows: LEGACY_SESSION_START_HOOK_COMMAND,
        statusMessage: "hatch3r:session-start-learnings",
      }] },
    ] } });
    const cleaned = parseCodexHooksJson(removeCodexOwnedHookEntries(content)!);
    expect(cleaned.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: "user" }] }]);
  });

  it("round-trips documented async and parsed-but-skipped user handlers", () => {
    const content = JSON.stringify({
      description: "user hooks",
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: "user", async: true, additionalContextLimit: 0 },
          { type: "prompt", prompt: "review this", model: "user-model" },
          { type: "agent", prompt: "delegate this", agent: "user-agent", custom: { retained: true } },
        ] }],
      },
    });
    const parsed = parseCodexHooksJson(content);
    const merged = mergeCodexHooksDocument(parsed, []);
    expect(merged).toEqual(JSON.parse(content));
    expect(removeCodexOwnedHookEntries(content)).toBe(content);
  });

  it.each([
    ['{"unknown":true,"hooks":{}}', "unknown top-level"],
    ['{"hooks":{"SessionStart":[{"hooks":[{"type":"future","command":"x"}]}]}}', "documented command, prompt, or agent"],
    ['{"hooks":{"MadeUp":[]}}', "unsupported event"],
  ])("rejects malformed or unsupported existing JSON %#", (content, message) => {
    expect(() => parseCodexHooksJson(content)).toThrow(message);
  });

  it("fails closed on a forged hatch3r ownership marker", () => {
    const doc = parseCodexHooksJson('{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"user","statusMessage":"hatch3r:session-start-learnings"}]}]}}');
    expect(() => mergeCodexHooksDocument(doc, [])).toThrow("ownership collision");
  });

  it("does not treat a skipped non-command handler as Hatcher-owned", () => {
    const content = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{
      type: "prompt",
      prompt: "user prompt",
      statusMessage: "hatch3r:session-start-learnings",
    }] }] } });
    expect(removeCodexOwnedHookEntries(content)).toBe(content);
  });

  it("preflights malformed established JSON when selected hooks are unsupported", async () => {
    const root = tempRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex/hooks.json"), "{broken\n");
    await expect(
      projectCodexHooks(root, [unsupportedHook], preflightCodexToml("")),
    ).rejects.toThrow("malformed JSON");
  });

  it.each(["valid", "dangling"])("rejects a %s final shared-file symlink before reading", async (kind) => {
    const root = tempRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    const outsideHooks = join(root, "outside-hooks.json");
    const outsideConfig = join(root, "outside-config.toml");
    if (kind === "valid") {
      await writeFile(outsideHooks, '{"hooks":{}}\n');
      await writeFile(outsideConfig, 'model = "user"\n');
    }
    await symlink(outsideHooks, join(root, ".codex/hooks.json"));
    await symlink(outsideConfig, join(root, ".codex/config.toml"));
    await expect(readCodexHooksPreflight(root)).rejects.toThrow("regular, non-symlink file");
    await expect(readCodexTomlPreflight(root)).rejects.toThrow("regular, non-symlink file");
  });

  it("executes the exact POSIX/Windows command from a nested cwd without trusting support files", async () => {
    const outer = tempRoot();
    const root = join(outer, "repo");
    await mkdir(root, { recursive: true });
    const projection = await projectCodexHooks(root, [sessionHook], preflightCodexToml(""));
    const support = projection.outputs.find((output) => output.path.endsWith(".mjs"))!;
    const hooksOutput = projection.outputs.find((output) => output.path === ".codex/hooks.json")!;
    const handler = parseCodexHooksJson(hooksOutput.content).hooks.SessionStart?.[0]?.hooks[0];
    expect(handler?.type).toBe("command");
    if (!handler || handler.type !== "command") throw new Error("missing generated command hook");
    const supportFile = join(root, support.path);
    const nested = join(root, "packages", "app");
    await mkdir(join(root, ".codex", "hatch3r", "hooks"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(supportFile, "throw new Error('project support file must not execute');\n");
    const ancestorSupport = join(outer, ".codex", "hatch3r", "hooks");
    await mkdir(ancestorSupport, { recursive: true });
    await writeFile(
      join(ancestorSupport, "hatch3r-session-start-learnings.mjs"),
      "process.stdout.write('UNTRUSTED-ANCESTOR-EXECUTED\\n');\n",
    );
    await writeFile(join(nested, "user-owned.txt"), "preserve exactly\n");

    const before = await snapshotTree(root);
    const command = process.platform === "win32" ? handler.commandWindows : handler.command;
    expect(command).toBeDefined();
    const shell = process.platform === "win32"
      ? process.env.ComSpec ?? "cmd.exe"
      : process.env.SHELL ?? "/bin/sh";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", command!]
      : ["-c", command!];
    const result = spawnSync(shell, args, {
      cwd: nested,
      encoding: "utf-8",
      input: "{}",
    });

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "hatch3r hook bridge session-start-learnings: delegate this task to the " +
      "hatch3r-learnings-loader custom subagent. If subagent delegation is unavailable, follow the " +
      "equivalent repository instructions and report the result in plain text. The hook itself performs " +
      "no repository mutation.",
    );
    expect(result.stdout).not.toContain("UNTRUSTED-ANCESTOR-EXECUTED");
    expect(await snapshotTree(root)).toEqual(before);
  });
});
