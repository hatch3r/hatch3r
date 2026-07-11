import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 12 D22-SA22.1-01 gate test.
 *
 * `scripts/validate-specialist-roster.ts` gained `checkPhase4TriggerReverse()`:
 * every agent whose frontmatter carries a `phase_4_trigger:` key — the shape the
 * 9 CQ specialists use to declare `SPECIALIST_TRIGGER_TABLE` membership — must be
 * a SSOT specialist OR a documented supporting-analyst exemption
 * (`SUPPORTING_ANALYST_PHASE4_ALLOWLIST`). The forward roster checks iterate the
 * SSOT and are structurally blind to an agent that carries the
 * membership-signalling key while ABSENT from the table (the D22-SA22.1-01
 * false-signal drift); this reverse check closes that gap.
 *
 * Two assertions:
 *   1. The real repo emits zero ROSTER-PHASE4-EXTRA findings — the 9 CQ
 *      phase_4_trigger agents are SSOT members and hatch3r-edge-case-analyst is
 *      the one documented exemption pending its B1 dispatch-classification
 *      decision.
 *   2. A synthetic agents/ tree with a phase_4_trigger agent that is neither a
 *      SSOT member nor an exemption trips ROSTER-PHASE4-EXTRA, proving the gate
 *      catches the drift class if a future agent reintroduces it.
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays clean.
 * Mirrors `src/__tests__/governance/fanout-path-currency-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = resolve(ROOT, "scripts", "validate-specialist-roster.ts");

interface RosterResult {
  errorCount: number;
  warningCount: number;
  findings: Array<{ level: string; code: string; file: string; message: string }>;
}

function runGate(rootDir: string): { result: RosterResult; exitCode: number; stderr: string } {
  let stdout: string;
  let stderr = "";
  let exitCode = 0;
  try {
    // Spawn node with the tsx loader directly (not the `.bin/tsx` POSIX shim,
    // which is not executable on Windows) — same pattern as the sibling gate
    // tests. `--root` points the validator at the synthetic fixture tree.
    stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", SCRIPT, "--json", "--root", rootDir],
      { cwd: ROOT, encoding: "utf-8", timeout: 60_000, env: { ...process.env, NODE_NO_WARNINGS: "1" } },
    );
  } catch (err: unknown) {
    // A non-zero exit (errors present in the fixture) still writes the JSON
    // result to stdout before process.exit(1); recover it from the thrown error.
    const e = err as { stdout?: string; stderr?: string; status?: number };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = e.status ?? 1;
  }
  return { result: JSON.parse(stdout) as RosterResult, exitCode, stderr };
}

describe("validate-specialist-roster reverse phase_4_trigger gate (D22-SA22.1-01)", () => {
  it("the real repo carries no phase_4_trigger agent outside the table-or-exemption set", () => {
    const { result, stderr } = runGate(ROOT);
    const extras = result.findings.filter((f) => f.code === "ROSTER-PHASE4-EXTRA");
    expect(
      extras,
      `unexpected ROSTER-PHASE4-EXTRA finding(s):\n${stderr}\n${JSON.stringify(extras, null, 2)}`,
    ).toEqual([]);
  });

  it("flags a phase_4_trigger agent that is neither a SSOT member nor an exemption", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d22-sa221-"));
    try {
      const agentsDir = join(dir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "hatch3r-fake-specialist.md"),
        [
          "---",
          "id: hatch3r-fake-specialist",
          "type: agent",
          "description: fixture agent that falsely signals SPECIALIST_TRIGGER_TABLE membership",
          "phase_4_trigger:",
          "  mode: conditional",
          "  conditions:",
          "    - some trigger condition",
          "---",
          "Fixture body.",
          "",
        ].join("\n"),
        "utf-8",
      );
      const { result } = runGate(dir);
      const extras = result.findings.filter((f) => f.code === "ROSTER-PHASE4-EXTRA");
      expect(extras.map((f) => f.file)).toContain("agents/hatch3r-fake-specialist.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag an agent that carries no phase_4_trigger frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d22-sa221-"));
    try {
      const agentsDir = join(dir, "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "hatch3r-plain-agent.md"),
        ["---", "id: hatch3r-plain-agent", "type: agent", "description: no trigger key", "---", "Body.", ""].join(
          "\n",
        ),
        "utf-8",
      );
      const { result } = runGate(dir);
      const extras = result.findings.filter((f) => f.code === "ROSTER-PHASE4-EXTRA");
      expect(extras).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
