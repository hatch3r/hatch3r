import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readHookDefinitions } from "../../hooks/index.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
const EMPTY_DIR = resolveTestPath(import.meta.url, "../fixtures");

describe("readHookDefinitions", () => {
  it("reads hook definitions from the hooks directory", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    expect(hooks.length).toBe(4);
    const ids = hooks.map((h) => h.id).sort();
    expect(ids).toEqual([
      "ci-failure-label-handler",
      "post-merge-deploy",
      "pre-commit-lint-fixer",
      "session-start-ci-watcher",
    ]);
  });

  it("parses event, agent, and description correctly", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const preCommit = hooks.find((h) => h.id === "pre-commit-lint-fixer");
    expect(preCommit).toBeDefined();
    expect(preCommit!.event).toBe("pre-commit");
    expect(preCommit!.agent).toBe("lint-fixer");
    expect(preCommit!.description).toBe("Run lint fixes before committing");
  });

  it("parses glob conditions from comma-separated values", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const preCommit = hooks.find((h) => h.id === "pre-commit-lint-fixer");
    expect(preCommit!.condition).toBeDefined();
    expect(preCommit!.condition!.globs).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
  });

  it("omits condition when no condition fields are present (always triggers)", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const sessionStart = hooks.find((h) => h.id === "session-start-ci-watcher");
    expect(sessionStart).toBeDefined();
    expect(sessionStart!.condition).toBeUndefined();
    expect(sessionStart!.event).toBe("session-start");
    expect(sessionStart!.agent).toBe("ci-watcher");
  });

  it("parses branch conditions from comma-separated values", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const postMerge = hooks.find((h) => h.id === "post-merge-deploy");
    expect(postMerge).toBeDefined();
    expect(postMerge!.event).toBe("post-merge");
    expect(postMerge!.agent).toBe("deploy-agent");
    expect(postMerge!.description).toBe("Deploy after merge to main");
    expect(postMerge!.condition).toBeDefined();
    expect(postMerge!.condition!.branches).toEqual(["main", "release/*"]);
    // Should not have globs or labels
    expect(postMerge!.condition!.globs).toBeUndefined();
    expect(postMerge!.condition!.labels).toBeUndefined();
  });

  it("parses label conditions from comma-separated values", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const ciFailure = hooks.find((h) => h.id === "ci-failure-label-handler");
    expect(ciFailure).toBeDefined();
    expect(ciFailure!.event).toBe("ci-failure");
    expect(ciFailure!.agent).toBe("triage-agent");
    expect(ciFailure!.description).toBe("Triage CI failures with specific labels");
    expect(ciFailure!.condition).toBeDefined();
    expect(ciFailure!.condition!.labels).toEqual(["type:bug", "status:blocked"]);
    // Should not have globs or branches
    expect(ciFailure!.condition!.globs).toBeUndefined();
    expect(ciFailure!.condition!.branches).toBeUndefined();
  });

  it("returns empty array when hooks directory does not exist", async () => {
    const hooks = await readHookDefinitions(EMPTY_DIR);
    expect(hooks).toEqual([]);
  });
});

describe("readHookDefinitions with inline fixtures", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setupHooksDir(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-hooks-"));
    const hooksDir = join(tempDir, "hooks");
    await mkdir(hooksDir, { recursive: true });
    return tempDir;
  }

  it("parses hook with combined glob and branch conditions", async () => {
    const agentsDir = await setupHooksDir();
    await writeFile(
      join(agentsDir, "hooks", "combined-conditions.md"),
      "---\nid: combined-check\nevent: pre-commit\nagent: checker\ndescription: Combined condition hook\nglobs: src/**/*.ts\nbranches: main, develop\n---\n# Combined\n\nHook with both globs and branches.\n",
      "utf-8",
    );

    const hooks = await readHookDefinitions(agentsDir);
    expect(hooks.length).toBe(1);
    const hook = hooks[0];
    expect(hook.id).toBe("combined-check");
    expect(hook.condition).toBeDefined();
    expect(hook.condition!.globs).toEqual(["src/**/*.ts"]);
    expect(hook.condition!.branches).toEqual(["main", "develop"]);
    expect(hook.condition!.labels).toBeUndefined();
  });

  it("parses hook with array-style globs in frontmatter", async () => {
    const agentsDir = await setupHooksDir();
    await writeFile(
      join(agentsDir, "hooks", "array-globs.md"),
      "---\nid: array-glob-hook\nevent: file-save\nagent: formatter\ndescription: Format on save\nglobs:\n  - \"*.ts\"\n  - \"*.tsx\"\n  - \"*.css\"\n---\n# Format\n\nFormat files on save.\n",
      "utf-8",
    );

    const hooks = await readHookDefinitions(agentsDir);
    expect(hooks.length).toBe(1);
    const hook = hooks[0];
    expect(hook.condition!.globs).toEqual(["*.ts", "*.tsx", "*.css"]);
  });

  it("parses hook with array-style labels in frontmatter", async () => {
    const agentsDir = await setupHooksDir();
    await writeFile(
      join(agentsDir, "hooks", "array-labels.md"),
      "---\nid: array-label-hook\nevent: ci-failure\nagent: triage\ndescription: Triage with labels\nlabels:\n  - priority:high\n  - type:bug\n---\n# Triage\n\nTriage high-priority bugs.\n",
      "utf-8",
    );

    const hooks = await readHookDefinitions(agentsDir);
    expect(hooks.length).toBe(1);
    const hook = hooks[0];
    expect(hook.condition!.labels).toEqual(["priority:high", "type:bug"]);
  });

  it("parses hook with array-style branches in frontmatter", async () => {
    const agentsDir = await setupHooksDir();
    await writeFile(
      join(agentsDir, "hooks", "array-branches.md"),
      "---\nid: array-branch-hook\nevent: pre-push\nagent: gate-keeper\ndescription: Gate keeper for branches\nbranches:\n  - main\n  - release/*\n  - hotfix/*\n---\n# Gate Keeper\n\nRun checks before push.\n",
      "utf-8",
    );

    const hooks = await readHookDefinitions(agentsDir);
    expect(hooks.length).toBe(1);
    const hook = hooks[0];
    expect(hook.event).toBe("pre-push");
    expect(hook.condition!.branches).toEqual(["main", "release/*", "hotfix/*"]);
  });

  it("skips hook files without valid frontmatter", async () => {
    const agentsDir = await setupHooksDir();
    await writeFile(
      join(agentsDir, "hooks", "no-frontmatter.md"),
      "# Just a markdown file\n\nNo frontmatter here.\n",
      "utf-8",
    );

    const hooks = await readHookDefinitions(agentsDir);
    expect(hooks.length).toBe(0);
  });

  it("skips hook files with invalid event type", async () => {
    const agentsDir = await setupHooksDir();
    await writeFile(
      join(agentsDir, "hooks", "bad-event.md"),
      "---\nid: bad-event-hook\nevent: invalid-event\nagent: some-agent\ndescription: Bad event\n---\n# Bad Event\n\nThis hook has an invalid event.\n",
      "utf-8",
    );

    const hooks = await readHookDefinitions(agentsDir);
    expect(hooks.length).toBe(0);
  });

  // D5-SA5.7-H3: Invalid event, missing frontmatter fields, malformed YAML,
  // and duplicate IDs must surface via the warnings channel instead of
  // silently dropping the hook (Silent Failure Contract, CONSTITUTION §2 P5).
  describe("D5-SA5.7-H3 diagnostic warnings", () => {
    it("emits INVALID_EVENT warning when event is not in the enum", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "typo-event.md"),
        "---\nid: typo-hook\nevent: pre-comit\nagent: checker\n---\n# Typo\n",
        "utf-8",
      );

      const warnings: string[] = [];
      const hooks = await readHookDefinitions(agentsDir, warnings);

      expect(hooks.length).toBe(0);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("INVALID_EVENT");
      expect(warnings[0]).toContain("pre-comit");
      expect(warnings[0]).toContain("typo-event.md");
      // Ensure the warning lists valid event names so the user can self-correct
      expect(warnings[0]).toContain("pre-commit");
    });

    it("emits MISSING_FIELD warning when required frontmatter fields are absent", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "missing-agent.md"),
        "---\nid: incomplete\nevent: pre-commit\n---\n# Incomplete\n",
        "utf-8",
      );

      const warnings: string[] = [];
      const hooks = await readHookDefinitions(agentsDir, warnings);

      expect(hooks.length).toBe(0);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("MISSING_FIELD");
      expect(warnings[0]).toContain("agent");
    });

    it("emits NO_FRONTMATTER warning when file has no --- block", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "plain.md"),
        "# Just prose, no frontmatter\n",
        "utf-8",
      );

      const warnings: string[] = [];
      const hooks = await readHookDefinitions(agentsDir, warnings);

      expect(hooks.length).toBe(0);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("NO_FRONTMATTER");
    });

    it("emits DUPLICATE_ID warning when the same hook id appears in two files", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "a-first.md"),
        "---\nid: dup-hook\nevent: pre-commit\nagent: agent-a\n---\n# First\n",
        "utf-8",
      );
      await writeFile(
        join(agentsDir, "hooks", "b-second.md"),
        "---\nid: dup-hook\nevent: pre-commit\nagent: agent-b\n---\n# Second\n",
        "utf-8",
      );

      const warnings: string[] = [];
      const hooks = await readHookDefinitions(agentsDir, warnings);

      // First wins; duplicate is rejected with a diagnostic
      expect(hooks.length).toBe(1);
      expect(hooks[0].agent).toBe("agent-a");
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("DUPLICATE_ID");
      expect(warnings[0]).toContain("b-second.md");
    });

    it("does not emit warnings for valid hooks", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "valid.md"),
        "---\nid: valid-hook\nevent: session-start\nagent: loader\n---\n# Valid\n",
        "utf-8",
      );

      const warnings: string[] = [];
      const hooks = await readHookDefinitions(agentsDir, warnings);

      expect(hooks.length).toBe(1);
      expect(warnings.length).toBe(0);
    });

    it("omits diagnostics when no warnings array is passed (back-compat)", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "bad.md"),
        "---\nid: bad\nevent: not-an-event\nagent: a\n---\n# Bad\n",
        "utf-8",
      );

      // Single-arg call (existing API) must continue to return empty array.
      const hooks = await readHookDefinitions(agentsDir);
      expect(hooks.length).toBe(0);
    });
  });
});
