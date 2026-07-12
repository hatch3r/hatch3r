import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 12 CL-2 U9 gate tests (D5-SA5.6-10) — skill/agent behavioral eval
 * harness, deterministic layers:
 *
 *   scripts/validate-skill-refs.ts       (layer a — reference lint)
 *   scripts/validate-skill-contracts.ts  (layer b — contract parity)
 *   scripts/run-skill-golden-set.ts      (layer c — fixture schema only;
 *                                         the LLM eval itself is manual)
 *
 * Subprocess form keeps every import inside `src/` (the scripts live under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors `src/__tests__/governance/archive-path-currency-gate.test.ts`.
 * Fixture trees are synthetic tmpdirs carrying a mini
 * `governance/inventory.json`; the real-corpus tests assert the shipped tree
 * stays green (the allowlist seed keeps the cycle-12 census visible without
 * failing the gate).
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const REFS_SCRIPT = resolve(ROOT, "scripts", "validate-skill-refs.ts");
const CONTRACTS_SCRIPT = resolve(ROOT, "scripts", "validate-skill-contracts.ts");
const GOLDEN_SCRIPT = resolve(ROOT, "scripts", "run-skill-golden-set.ts");

interface RefsResult {
  filesScanned: number;
  errorCount: number;
  findings: Array<{ code: string; file: string; line: number; token: string }>;
  allowlisted: Array<{ code: string; file: string; token: string }>;
}

interface ContractsResult {
  skillsChecked: number;
  errorCount: number;
  findings: Array<{ code: string; file: string; token: string }>;
  allowlisted: Array<{ code: string; file: string; token: string }>;
}

function runScript(script: string, args: string[]): { stdout: string; exitCode: number; stderr: string } {
  let stdout: string;
  let stderr = "";
  let exitCode = 0;
  try {
    // Spawn node with the tsx loader directly (not the `.bin/tsx` POSIX shim,
    // which is not executable on Windows) — same pattern as
    // `src/__tests__/governance/archive-path-currency-gate.test.ts`.
    stdout = execFileSync(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = e.status ?? 1;
  }
  return { stdout, exitCode, stderr };
}

function runRefs(root: string): { result: RefsResult; exitCode: number; stderr: string } {
  const { stdout, exitCode, stderr } = runScript(REFS_SCRIPT, ["--json", "--root", root]);
  return { result: JSON.parse(stdout) as RefsResult, exitCode, stderr };
}

function runContracts(root: string): { result: ContractsResult; exitCode: number; stderr: string } {
  const { stdout, exitCode, stderr } = runScript(CONTRACTS_SCRIPT, ["--json", "--root", root]);
  return { result: JSON.parse(stdout) as ContractsResult, exitCode, stderr };
}

// ── Fixture tree builder ──────────────────────────────────────────

const MINI_INVENTORY = {
  files: {
    agents: ["hatch3r-implementer.md", "hatch3r-reviewer.md"],
    skills: ["hatch3r-real-skill/SKILL.md"],
    cliSkills: ["hatch3r-cli-demo/SKILL.md"],
    rules: ["hatch3r-real-rule.md"],
    commands: ["hatch3r-real-command.md"],
  },
};

interface FixtureOptions {
  inventory?: object;
}

/** Build a minimal repo tree: governance/inventory.json + canonical dirs. */
function makeFixture(options: FixtureOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "h3-u9-"));
  mkdirSync(join(dir, "governance"), { recursive: true });
  writeFileSync(join(dir, "governance", "inventory.json"), JSON.stringify(options.inventory ?? MINI_INVENTORY), "utf-8");
  mkdirSync(join(dir, "agents"), { recursive: true });
  mkdirSync(join(dir, "commands"), { recursive: true });
  mkdirSync(join(dir, "rules"), { recursive: true });
  return dir;
}

function writeSkill(dir: string, name: string, content: string): void {
  const skillDir = join(dir, "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
}

const CONFORMANT_SKILL = [
  "---",
  "id: hatch3r-real-skill",
  "type: skill",
  "description: A demo skill",
  "tags: [implementation]",
  "---",
  "",
  "# Demo",
  "",
  "## Quick Start",
  "",
  "Do the thing.",
  "",
  "## Step 1: Do it",
  "",
  "Reference `hatch3r-implementer` and `rules/hatch3r-real-rule.md`.",
  "",
].join("\n");

// ── Layer (a): validate-skill-refs ────────────────────────────────

describe("validate-skill-refs gate (CL-2 U9, D5-SA5.6-10)", () => {
  it("the real corpus is green — census danglers are allowlisted, not silently dropped", () => {
    const { result, exitCode, stderr } = runRefs(ROOT);
    expect(result.errorCount, `unexpected danglers:\n${JSON.stringify(result.findings, null, 2)}\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    // skills(53) + agents(29) + commands(31) = 113 at seed time; assert a sane floor.
    expect(result.filesScanned).toBeGreaterThan(100);
    // The cycle-12 census must stay VISIBLE (25 hits at seed time). If this
    // drops, entries were fixed — remove them from the allowlist in the same
    // change; if it grows, someone allowlisted new danglers.
    expect(result.allowlisted.length).toBeGreaterThan(0);
  });

  it("flags a ghost id (the /h4tcher-learn class) with file:line diagnostics", () => {
    const dir = makeFixture();
    try {
      writeSkill(dir, "hatch3r-real-skill", "# S\n\nRoute learnings to the `/h4tcher-learn` skill.\n");
      const { result, exitCode } = runRefs(dir);
      expect(exitCode).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        code: "SKILL-REF-ID-UNRESOLVED",
        file: "skills/hatch3r-real-skill/SKILL.md",
        line: 3,
        token: "/h4tcher-learn",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves slash-command and .md-basename forms against inventory ids", () => {
    const dir = makeFixture();
    try {
      writeSkill(
        dir,
        "hatch3r-real-skill",
        "# S\n\nSee `/hatch3r-real-command` and `hatch3r-implementer.md` and `hatch3r-real-rule`.\n",
      );
      const { result, exitCode } = runRefs(dir);
      expect(result.findings).toEqual([]);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags a dangling canonical path and passes an existing one", () => {
    const dir = makeFixture();
    try {
      writeFileSync(join(dir, "rules", "hatch3r-real-rule.md"), "# rule\n", "utf-8");
      writeSkill(
        dir,
        "hatch3r-real-skill",
        "# S\n\nRead `rules/hatch3r-real-rule.md`.\n\nAlso read `rules/hatch3r-ghost-rule.md`.\n",
      );
      const { result, exitCode } = runRefs(dir);
      expect(exitCode).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        code: "SKILL-REF-PATH-MISSING",
        line: 5,
        token: "rules/hatch3r-ghost-rule.md",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not path-check end-user roots (docs/, src/, .claude/) or placeholder spans", () => {
    const dir = makeFixture();
    try {
      writeSkill(
        dir,
        "hatch3r-real-skill",
        [
          "# S",
          "",
          "Write the spec to `docs/specs/prd.md` in the user's repo.",
          "Scaffold `src/auth/oauth` next.",
          "The claude adapter emits `.claude/agents/hatch3r-implementer.md`.",
          "Template: `skills/hatch3r-cli-<tool>/SKILL.md` and `hatch3r-*` ids.",
          "",
        ].join("\n"),
      );
      const { result, exitCode } = runRefs(dir);
      expect(result.findings).toEqual([]);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips fenced code blocks for id/path checks but still resolves subagent_type inside fences", () => {
    const dir = makeFixture();
    try {
      writeSkill(
        dir,
        "hatch3r-real-skill",
        [
          "# S",
          "",
          "```yaml",
          "example: `hatch3r-fence-only-ghost`",
          'subagent_type: "hatch3r-ghost-agent"',
          "```",
          "",
        ].join("\n"),
      );
      const { result, exitCode } = runRefs(dir);
      expect(exitCode).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        code: "SKILL-REF-SUBAGENT-UNKNOWN",
        line: 5,
        token: "hatch3r-ghost-agent",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags the writeHandoff class (call notation paired with a src/**.ts path) but not a bare descriptive mention", () => {
    const dir = makeFixture();
    try {
      mkdirSync(join(dir, "src", "content"), { recursive: true });
      writeFileSync(join(dir, "src", "content", "mod.ts"), "export {};\n", "utf-8");
      writeSkill(
        dir,
        "hatch3r-real-skill",
        [
          "# S",
          "",
          "Call `writeThing(dir, data)` from `src/content/mod.ts`.",
          "`writeThing` is the CLI-internal writer in `src/content/mod.ts`, not your call target.",
          "",
        ].join("\n"),
      );
      const { result, exitCode } = runRefs(dir);
      expect(exitCode).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        code: "SKILL-REF-TS-CALL",
        line: 3,
        token: "writeThing(dir, data)",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the allowlist suppresses a matching (file, token, code) hit and reports it as census-visible", () => {
    const dir = makeFixture();
    try {
      writeSkill(dir, "hatch3r-real-skill", "# S\n\nGhost: `/h4tcher-ghost`.\n");
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(
        join(dir, "scripts", "skill-eval-allowlist.json"),
        JSON.stringify({
          refs: [
            {
              file: "skills/hatch3r-real-skill/SKILL.md",
              token: "/h4tcher-ghost",
              code: "SKILL-REF-ID-UNRESOLVED",
              reason: "forward-reference: test",
              added: "2026-07-12",
            },
          ],
        }),
        "utf-8",
      );
      const { result, exitCode } = runRefs(dir);
      expect(result.findings).toEqual([]);
      expect(result.allowlisted).toHaveLength(1);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Layer (b): validate-skill-contracts ───────────────────────────

describe("validate-skill-contracts gate (CL-2 U9, D5-SA5.6-10)", () => {
  it("the real corpus is green with the census allowlist visible", () => {
    const { result, exitCode, stderr } = runContracts(ROOT);
    expect(result.errorCount, `contract violations:\n${JSON.stringify(result.findings, null, 2)}\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    expect(result.skillsChecked).toBeGreaterThan(50);
    expect(result.allowlisted.length).toBeGreaterThan(0);
  });

  it("a conformant skill passes all contracts", () => {
    const dir = makeFixture();
    try {
      writeSkill(dir, "hatch3r-real-skill", CONFORMANT_SKILL);
      writeFileSync(join(dir, "rules", "hatch3r-real-rule.md"), "# rule\n", "utf-8");
      const { result, exitCode } = runContracts(dir);
      expect(result.findings).toEqual([]);
      expect(exitCode).toBe(0);
      expect(result.skillsChecked).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags id-dir mismatch, missing description, empty tags, and missing Quick Start/Step structure", () => {
    const dir = makeFixture();
    try {
      writeSkill(
        dir,
        "hatch3r-real-skill",
        ["---", "id: hatch3r-wrong-id", "type: rule", "tags: []", "---", "", "# No structure here", ""].join("\n"),
      );
      const { result, exitCode } = runContracts(dir);
      expect(exitCode).toBe(1);
      const codes = result.findings.map((f) => f.code).sort();
      expect(codes).toEqual([
        "SKILL-CONTRACT-ID-DIR",
        "SKILL-CONTRACT-NO-DESCRIPTION",
        "SKILL-CONTRACT-NO-QUICK-START",
        "SKILL-CONTRACT-NO-STEP",
        "SKILL-CONTRACT-NO-TAGS",
        "SKILL-CONTRACT-TYPE",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exempts inventory-listed CLI skills from the Quick Start/Step structural checks only", () => {
    const dir = makeFixture();
    try {
      writeSkill(
        dir,
        "hatch3r-cli-demo",
        ["---", "id: hatch3r-cli-demo", "type: skill", "description: CLI card", "tags: [maintenance]", "---", "", "# Tool card, no steps", ""].join("\n"),
      );
      const { result, exitCode } = runContracts(dir);
      expect(result.findings).toEqual([]);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats unparseable frontmatter as a contract error", () => {
    const dir = makeFixture();
    try {
      writeSkill(dir, "hatch3r-real-skill", "no frontmatter at all\n");
      const { result, exitCode } = runContracts(dir);
      expect(exitCode).toBe(1);
      expect(result.findings.map((f) => f.code)).toEqual(["SKILL-CONTRACT-BAD-FRONTMATTER"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Layer (c): golden-set fixtures + runner (deterministic surface) ──

describe("run-skill-golden-set (CL-2 U9, D5-SA5.6-10) — fixture schema", () => {
  it("the shipped golden set is schema-valid: 11 fixtures (6 CLI + 5 workflow), >=2 cases each", () => {
    const { stdout, exitCode, stderr } = runScript(GOLDEN_SCRIPT, ["--json"]);
    expect(exitCode, stderr).toBe(0);
    const parsed = JSON.parse(stdout) as { fixtureCount: number; caseCount: number; prompts: Array<{ skill: string; cohort: string; caseId: string; prompt: string }> };
    expect(parsed.fixtureCount).toBe(11);
    expect(parsed.caseCount).toBeGreaterThanOrEqual(22);
    const cohorts = new Map<string, string>();
    for (const p of parsed.prompts) cohorts.set(p.skill, p.cohort);
    expect([...cohorts.values()].filter((c) => c === "cli")).toHaveLength(6);
    expect([...cohorts.values()].filter((c) => c === "workflow")).toHaveLength(5);
    // Every prompt embeds the manual-eval essentials.
    for (const p of parsed.prompts) {
      expect(p.prompt).toContain("JUDGE RUBRIC:");
      expect(p.prompt).toContain("EXPECTED (positive criteria):");
    }
  });

  it("rejects a schema-violating fixture (single case, missing rubric) with exit 1", () => {
    const dir = makeFixture();
    try {
      const fxDir = join(dir, "scripts", "eval-fixtures", "skill-golden-set");
      mkdirSync(fxDir, { recursive: true });
      writeSkill(dir, "hatch3r-real-skill", CONFORMANT_SKILL);
      writeFileSync(
        join(fxDir, "hatch3r-real-skill.json"),
        JSON.stringify({
          skill: "hatch3r-real-skill",
          skillPath: "skills/hatch3r-real-skill/SKILL.md",
          cohort: "workflow",
          cases: [{ id: "only-one", input: "do it", expected: ["works"] }],
        }),
        "utf-8",
      );
      const { exitCode, stderr } = runScript(GOLDEN_SCRIPT, ["--root", dir]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("GOLDEN-SET-SCHEMA");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a fixture whose skillPath does not exist", () => {
    const dir = makeFixture();
    try {
      const fxDir = join(dir, "scripts", "eval-fixtures", "skill-golden-set");
      mkdirSync(fxDir, { recursive: true });
      writeFileSync(
        join(fxDir, "hatch3r-gone.json"),
        JSON.stringify({
          skill: "hatch3r-gone",
          skillPath: "skills/hatch3r-gone/SKILL.md",
          cohort: "workflow",
          cases: [
            { id: "a", input: "x", expected: ["y"], rubric: "PASS iff y" },
            { id: "b", input: "x2", expected: ["y2"], rubric: "PASS iff y2" },
          ],
        }),
        "utf-8",
      );
      const { exitCode, stderr } = runScript(GOLDEN_SCRIPT, ["--root", dir]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
