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

  // D1-29 (Cycle 11 Wave 3, CQ3): a pack-supplied hook `description`
  // containing a double-quote or newline previously flowed raw into the
  // Cursor `description: "Hook: ${...}"` quoted YAML scalar, where the `"`
  // injects a stray frontmatter key. The reader now strips those characters
  // at parse time (the single point where the field enters HookDefinition),
  // protecting every downstream adapter template.
  describe("D1-29 description sanitization", () => {
    it("strips YAML/shell metacharacters from a hostile description", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "hostile-desc.md"),
        '---\nid: hostile-hook\nevent: session-start\nagent: loader\ndescription: "Break\\" then $(touch pwned); `id`"\n---\n# Hostile\n',
        "utf-8",
      );

      const hooks = await readHookDefinitions(agentsDir);
      expect(hooks.length).toBe(1);
      const desc = hooks[0].description;
      // None of the YAML-scalar-breaking or shell-injection characters survive.
      expect(desc).not.toMatch(/["`$;|&\n\r\\]/);
      // The benign words remain so the description is still meaningful.
      expect(desc).toContain("Break");
      expect(desc).toContain("then");
      expect(desc).toContain("touch pwned");
    });

    it("strips a literal newline injected via a folded YAML scalar", async () => {
      const agentsDir = await setupHooksDir();
      // A YAML double-quoted scalar with an escaped newline (\n) decodes to a
      // real newline in the parsed string — which would split the Cursor
      // frontmatter / inject an extra markdown line if left raw.
      await writeFile(
        join(agentsDir, "hooks", "newline-desc.md"),
        '---\nid: newline-hook\nevent: session-start\nagent: loader\ndescription: "line one\\nalwaysApply: true"\n---\n# Newline\n',
        "utf-8",
      );

      const hooks = await readHookDefinitions(agentsDir);
      expect(hooks.length).toBe(1);
      expect(hooks[0].description).not.toMatch(/[\n\r]/);
      // The stray key text is flattened into the single-line description
      // rather than becoming a real second frontmatter line.
      expect(hooks[0].description).toBe("line onealwaysApply: true");
    });

    it("leaves a clean description unchanged", async () => {
      const agentsDir = await setupHooksDir();
      await writeFile(
        join(agentsDir, "hooks", "clean-desc.md"),
        "---\nid: clean-hook\nevent: session-start\nagent: loader\ndescription: Run lint fixes before committing\n---\n# Clean\n",
        "utf-8",
      );

      const hooks = await readHookDefinitions(agentsDir);
      expect(hooks.length).toBe(1);
      expect(hooks[0].description).toBe("Run lint fixes before committing");
    });
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

  // C8-D2-M3 (D2-SA2.2-3): `readdir({recursive:true})` can enumerate through
  // symlinks, which risks infinite recursion and cross-repo reads. The
  // lstat-gate inside the reader now skips symbolic links and emits a
  // SYMLINK_SKIPPED diagnostic so the skip is not silent.
  describe("C8-D2-M3 symlink skip", () => {
    it.skipIf(process.platform === "win32")(
      "skips a symbolic link inside hooks/ and surfaces SYMLINK_SKIPPED",
      async () => {
        const agentsDir = await setupHooksDir();
        const { symlink } = await import("node:fs/promises");
        // Real hook that must still load.
        await writeFile(
          join(agentsDir, "hooks", "real.md"),
          "---\nid: real-hook\nevent: session-start\nagent: loader\n---\n# Real\n",
          "utf-8",
        );
        // Symlink inside hooks/ pointing at the real hook. Without the
        // lstat-gate, readdir(recursive) would enumerate this as a separate
        // entry and parseHookFrontmatter would reject it as a duplicate id.
        // With the gate, it is skipped and the SYMLINK_SKIPPED warning fires.
        await symlink(join(agentsDir, "hooks", "real.md"), join(agentsDir, "hooks", "link.md"));

        const warnings: string[] = [];
        const hooks = await readHookDefinitions(agentsDir, warnings);

        // Exactly one hook loaded — the symlink did not double-register.
        expect(hooks.length).toBe(1);
        expect(hooks[0].id).toBe("real-hook");
        // The symlink skip surfaces as a diagnostic (not silent).
        expect(warnings.some((w) => w.includes("SYMLINK_SKIPPED") && w.includes("link.md"))).toBe(true);
        // And no DUPLICATE_ID warning — the symlink was rejected before the
        // duplicate-id check ran, so operators aren't confused into thinking
        // they wrote two hooks with the same id.
        expect(warnings.some((w) => w.includes("DUPLICATE_ID"))).toBe(false);
      },
    );

    it.skipIf(process.platform === "win32")(
      "skips dangling symlinks without throwing",
      async () => {
        const agentsDir = await setupHooksDir();
        const { symlink } = await import("node:fs/promises");
        // Symlink pointing at a path that does not exist. Before the
        // lstat-gate, readFile(fullPath) would throw ENOENT and abort the
        // read. With the gate, the dangling link is skipped cleanly.
        await symlink(
          join(agentsDir, "hooks", "missing.md"),
          join(agentsDir, "hooks", "dangling.md"),
        );
        await writeFile(
          join(agentsDir, "hooks", "real.md"),
          "---\nid: real-hook\nevent: session-start\nagent: loader\n---\n# Real\n",
          "utf-8",
        );

        const warnings: string[] = [];
        const hooks = await readHookDefinitions(agentsDir, warnings);

        expect(hooks.length).toBe(1);
        expect(hooks[0].id).toBe("real-hook");
        expect(warnings.some((w) => w.includes("SYMLINK_SKIPPED") && w.includes("dangling.md"))).toBe(true);
      },
    );
  });
});
