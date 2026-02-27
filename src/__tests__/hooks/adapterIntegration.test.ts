import { describe, it, expect } from "vitest";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("ClaudeAdapter hooks integration", () => {
  const adapter = new ClaudeAdapter();

  it("includes hooks config in settings.json when hooks exist", async () => {
    const manifest = createManifest({
      tools: ["claude"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
    expect(parsed.hooks.SessionStart).toBeDefined();
  });

  it("hooks contain matcher and command entries", async () => {
    const manifest = createManifest({
      tools: ["claude"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);

    const preToolUseHooks = parsed.hooks.PreToolUse;
    expect(Array.isArray(preToolUseHooks)).toBe(true);
    expect(preToolUseHooks.length).toBeGreaterThan(0);

    const hookEntry = preToolUseHooks[0];
    expect(hookEntry.matcher).toBeDefined();
    expect(hookEntry.hooks).toBeDefined();
    expect(hookEntry.hooks[0].type).toBe("command");
    expect(hookEntry.hooks[0].command).toContain("hatch3r hook");
  });

  it("skips hooks when features.hooks is false", async () => {
    const manifest = createManifest({
      tools: ["claude"],

      mcpServers: [],
      features: { hooks: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeUndefined();
  });
});

describe("CursorAdapter hooks integration", () => {
  const adapter = new CursorAdapter();

  it("generates hook rule files for each hook definition", async () => {
    const manifest = createManifest({
      tools: ["cursor"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter((o) =>
      o.path.startsWith(".cursor/rules/hatch3r-hook-"),
    );
    expect(hookRules.length).toBe(2);

    const ids = hookRules.map((r) => r.path).sort();
    expect(ids).toEqual([
      ".cursor/rules/hatch3r-hook-pre-commit-lint-fixer.mdc",
      ".cursor/rules/hatch3r-hook-session-start-ci-watcher.mdc",
    ]);
  });

  it("includes glob patterns in hook rules when conditions have globs", async () => {
    const manifest = createManifest({
      tools: ["cursor"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const lintHook = outputs.find((o) =>
      o.path.includes("hatch3r-hook-pre-commit-lint-fixer"),
    );
    expect(lintHook).toBeDefined();
    expect(lintHook!.content).toContain('globs: ["src/**/*.ts", "src/**/*.tsx"]');
    expect(lintHook!.content).toContain("lint-fixer");
    expect(lintHook!.content).toContain("pre-commit");
  });

  it("uses alwaysApply: false for hooks without glob conditions", async () => {
    const manifest = createManifest({
      tools: ["cursor"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const ciHook = outputs.find((o) =>
      o.path.includes("hatch3r-hook-session-start-ci-watcher"),
    );
    expect(ciHook).toBeDefined();
    expect(ciHook!.content).toContain("alwaysApply: false");
    expect(ciHook!.content).not.toContain("globs:");
  });

  it("skips hooks when features.hooks is false", async () => {
    const manifest = createManifest({
      tools: ["cursor"],

      mcpServers: [],
      features: { hooks: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter((o) =>
      o.path.startsWith(".cursor/rules/hatch3r-hook-"),
    );
    expect(hookRules.length).toBe(0);
  });

  it("hook rules are managed and have action create", async () => {
    const manifest = createManifest({
      tools: ["cursor"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hookRules = outputs.filter((o) =>
      o.path.startsWith(".cursor/rules/hatch3r-hook-"),
    );
    for (const rule of hookRules) {
      expect(rule.managedContent).toBeDefined();
      expect(rule.action).toBe("create");
    }
  });
});
