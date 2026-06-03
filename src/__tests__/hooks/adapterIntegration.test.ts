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
    expect(hookEntry.hooks[0].command).toContain("HATCH3R_HOOK_ACTIVATED");
  });

  it("skips user-defined hooks when features.hooks is false but keeps Agent Teams hooks", async () => {
    const manifest = createManifest({
      tools: ["claude"],

      mcpServers: [],
      features: { hooks: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.SessionStart).toBeUndefined();
    expect(parsed.hooks.TaskCompleted).toBeDefined();
    expect(parsed.hooks.TeammateIdle).toBeDefined();
    expect(parsed.hooks.PreToolUse).toBeDefined();
    // Shell-form launcher anchored to $CLAUDE_PROJECT_DIR so the script
    // resolves regardless of the hook's working directory (cwd-relative
    // paths threw cjs/loader:1386 when the hook fired from an Agent-spawned
    // sub-agent). `node` comes from PATH, not the generation-time
    // process.execPath.
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe(
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-allowlist.mjs"',
    );
    expect(parsed.hooks.PreToolUse[0].hooks[0].args).toBeUndefined();
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
    expect(hookRules.length).toBe(4);

    const ids = hookRules.map((r) => r.path).sort();
    expect(ids).toEqual([
      ".cursor/rules/hatch3r-hook-ci-failure-label-handler.mdc",
      ".cursor/rules/hatch3r-hook-post-merge-deploy.mdc",
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

// D2-M02 (D2 Medium, Cycle 10 Wave 3 rollover): the hook parser surfaces
// diagnostics for malformed hooks (NO_FRONTMATTER, INVALID_EVENT,
// MISSING_FIELD, YAML_PARSE_ERROR, DUPLICATE_ID, SYMLINK_SKIPPED) into the
// optional `warnings` out-parameter. `BaseAdapter.loadHookDefinitions` calls
// `readHookDefinitions(ctx.canonicalRoot, this.warnings)` so adapter
// invocations must observe those diagnostics on `adapter.warnings` end-to-end.
// Pre-fix, there was no test asserting this propagation — a regression that
// removed the `this.warnings` argument would have produced an adapter that
// silently dropped malformed hooks (Silent Failure Contract, CONSTITUTION §2
// P5). These tests close that gap by exercising the full chain:
//   bad hook file -> readHookDefinitions(warnings) -> adapter.warnings[]
import { describe as describeProp, it as itProp, expect as expectProp } from "vitest";
import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describeProp("hook-parse warning propagation (D2-M02)", () => {
  async function stageMalformedHook(): Promise<string> {
    // Mirror the canonical fixture layout (.agents-style root with agents/
    // skills/rules/hooks/ subdirs) but inject a malformed hook so every
    // generate() pass observes the warning.
    const root = await mkdtemp(join(tmpdir(), "hatch3r-d2m02-"));
    // Copy the existing fixture root so legitimate canonical reads succeed
    // (the adapters require agents/, rules/, skills/ to be populated; we
    // then ADD a malformed hook on top).
    await cp(FIXTURES_DIR, root, { recursive: true });
    // Author a hook with an INVALID_EVENT typo. The hook parser rejects it
    // with `[hooks] INVALID_EVENT: ...` and we expect that warning on the
    // adapter's `warnings` array after generate().
    const hooksDir = join(root, "hooks");
    await mkdir(hooksDir, { recursive: true });
    await writeFile(
      join(hooksDir, "typo-event.md"),
      "---\nid: typo-event-hook\nevent: pre-comit\nagent: lint-fixer\n---\n# Typo\n",
      "utf-8",
    );
    return root;
  }

  itProp(
    "ClaudeAdapter propagates INVALID_EVENT hook diagnostics into adapter.warnings",
    async () => {
      const root = await stageMalformedHook();
      try {
        const adapter = new ClaudeAdapter();
        const manifest = createManifest({ tools: ["claude"], mcpServers: [] });
        await adapter.generate(root, manifest);
        const hookWarnings = adapter.warnings.filter((w) =>
          w.includes("[hooks] INVALID_EVENT"),
        );
        expectProp(hookWarnings.length).toBeGreaterThan(0);
        expectProp(hookWarnings[0]).toContain("pre-comit");
        expectProp(hookWarnings[0]).toContain("typo-event.md");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  itProp(
    "CursorAdapter propagates INVALID_EVENT hook diagnostics into adapter.warnings",
    async () => {
      const root = await stageMalformedHook();
      try {
        const adapter = new CursorAdapter();
        const manifest = createManifest({ tools: ["cursor"], mcpServers: [] });
        await adapter.generate(root, manifest);
        const hookWarnings = adapter.warnings.filter((w) =>
          w.includes("[hooks] INVALID_EVENT"),
        );
        expectProp(hookWarnings.length).toBeGreaterThan(0);
        expectProp(hookWarnings[0]).toContain("pre-comit");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  itProp(
    "Hook parser MISSING_FIELD diagnostics propagate end-to-end through ClaudeAdapter",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "hatch3r-d2m02-miss-"));
      try {
        await cp(FIXTURES_DIR, root, { recursive: true });
        const hooksDir = join(root, "hooks");
        await mkdir(hooksDir, { recursive: true });
        // Missing required `agent` field.
        await writeFile(
          join(hooksDir, "no-agent.md"),
          "---\nid: no-agent-hook\nevent: pre-commit\n---\n# No agent\n",
          "utf-8",
        );
        const adapter = new ClaudeAdapter();
        const manifest = createManifest({ tools: ["claude"], mcpServers: [] });
        await adapter.generate(root, manifest);
        const missingFieldWarnings = adapter.warnings.filter((w) =>
          w.includes("[hooks] MISSING_FIELD"),
        );
        expectProp(missingFieldWarnings.length).toBeGreaterThan(0);
        expectProp(missingFieldWarnings[0]).toContain("agent");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
