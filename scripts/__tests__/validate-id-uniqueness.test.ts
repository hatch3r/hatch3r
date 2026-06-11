import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PENDING_DECOMMISSION_BASE_IDS,
  detectCollisions,
  discoverCommandBaseIds,
  discoverSkillBaseIds,
  formatFinding,
  runValidator,
  toBaseId,
} from "../validate-id-uniqueness.js";

// ── Pure base-id derivation ───────────────────────────────────────

describe("toBaseId", () => {
  it("strips the hatch3r- prefix", () => {
    expect(toBaseId("hatch3r-release")).toBe("release");
    expect(toBaseId("hatch3r-api-spec")).toBe("api-spec");
  });

  it("returns an unprefixed name unchanged", () => {
    expect(toBaseId("board-shared")).toBe("board-shared");
  });
});

// ── Discovery over a temp corpus ──────────────────────────────────

describe("discoverCommandBaseIds (temp root)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "id-uniq-cmd-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists base ids of hatch3r-*.md command files only", async () => {
    await mkdir(join(dir, "commands", "board"), { recursive: true });
    await writeFile(join(dir, "commands", "hatch3r-release.md"), "id: hatch3r-release\n", "utf8");
    await writeFile(join(dir, "commands", "hatch3r-spec.md"), "id: hatch3r-spec\n", "utf8");
    // Non-prefixed and companion-subdir files are excluded.
    await writeFile(join(dir, "commands", "README.md"), "x\n", "utf8");
    await writeFile(join(dir, "commands", "board", "hatch3r-board-fill.md"), "x\n", "utf8");
    expect(await discoverCommandBaseIds(dir)).toEqual(["release", "spec"]);
  });

  it("returns [] when commands/ is absent", async () => {
    expect(await discoverCommandBaseIds(dir)).toEqual([]);
  });
});

describe("discoverSkillBaseIds (temp root)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "id-uniq-skill-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists base ids of hatch3r-*/ dirs that contain a SKILL.md", async () => {
    await mkdir(join(dir, "skills", "hatch3r-release"), { recursive: true });
    await writeFile(join(dir, "skills", "hatch3r-release", "SKILL.md"), "id: hatch3r-release\n", "utf8");
    await mkdir(join(dir, "skills", "hatch3r-feature"), { recursive: true });
    await writeFile(join(dir, "skills", "hatch3r-feature", "SKILL.md"), "x\n", "utf8");
    // A prefixed dir with NO SKILL.md is not a published skill.
    await mkdir(join(dir, "skills", "hatch3r-empty"), { recursive: true });
    await writeFile(join(dir, "skills", "hatch3r-empty", "notes.md"), "x\n", "utf8");
    expect(await discoverSkillBaseIds(dir)).toEqual(["feature", "release"]);
  });

  it("returns [] when skills/ is absent", async () => {
    expect(await discoverSkillBaseIds(dir)).toEqual([]);
  });
});

// ── Collision detection (the core property) ───────────────────────

describe("detectCollisions", () => {
  it("ERROR: a NEW command↔skill collision outside the allowlist fails the gate", () => {
    const findings = detectCollisions(["spec"], ["spec"], [] /* empty allowlist */);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].code).toBe("ID-UNIQ-COMMAND-SKILL-COLLISION");
    expect(findings[0].baseId).toBe("spec");
    // Steers to a distinct id / collapse / delete.
    expect(findings[0].message).toMatch(/distinct base id/);
  });

  it("WARN (not error): an allowlisted pending-decommission collision is non-failing", () => {
    const findings = detectCollisions(["release"], ["release"], ["release"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("warning");
    expect(findings[0].code).toBe("ID-UNIQ-COMMAND-SKILL-PENDING");
    expect(findings[0].message).toMatch(/D16-10/);
  });

  it("ERROR: a stale allowlist entry (no live collision) must be pruned", () => {
    // 'release' is allowlisted but the skill twin is gone (only the command exists).
    const findings = detectCollisions(["release"], [], ["release"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].code).toBe("ID-UNIQ-STALE-ALLOWLIST");
    expect(findings[0].message).toMatch(/PENDING_DECOMMISSION_BASE_IDS/);
  });

  it("PASS: disjoint command and skill base ids produce no findings", () => {
    // Empty allowlist isolates the collision property from stale-allowlist checks.
    expect(detectCollisions(["spec", "debug"], ["feature", "learn"], [])).toHaveLength(0);
  });

  it("does NOT flag agent↔rule-style same-name pairs (not in the command/skill sets)", () => {
    // The CQ specialist pairs (security agent + security rule) never enter the
    // command or skill sets, so they cannot collide here by construction.
    expect(detectCollisions([], [], [])).toHaveLength(0);
  });

  it("reports findings sorted by base id", () => {
    const findings = detectCollisions(["zebra", "alpha"], ["zebra", "alpha"], []);
    expect(findings.map((f) => f.baseId)).toEqual(["alpha", "zebra"]);
  });
});

// ── runValidator over a temp repo root ────────────────────────────

describe("runValidator (temp root)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "id-uniq-run-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ERROR end-to-end: a non-allowlisted command↔skill twin fails the gate", async () => {
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(join(dir, "commands", "hatch3r-spec.md"), "id: hatch3r-spec\n", "utf8");
    await mkdir(join(dir, "skills", "hatch3r-spec"), { recursive: true });
    await writeFile(join(dir, "skills", "hatch3r-spec", "SKILL.md"), "id: hatch3r-spec\n", "utf8");
    // Empty injected allowlist: the synthetic 'spec' twin is a hard error and the
    // production allowlist does not fire stale-allowlist noise against this root.
    const result = await runValidator({ rootDir: dir, pending: [] });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("ID-UNIQ-COMMAND-SKILL-COLLISION");
    expect(result.commandCount).toBe(1);
    expect(result.skillCount).toBe(1);
  });

  it("PASS end-to-end: no command↔skill overlap is clean", async () => {
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(join(dir, "commands", "hatch3r-debug.md"), "id: hatch3r-debug\n", "utf8");
    await mkdir(join(dir, "skills", "hatch3r-learn"), { recursive: true });
    await writeFile(join(dir, "skills", "hatch3r-learn", "SKILL.md"), "id: hatch3r-learn\n", "utf8");
    const result = await runValidator({ rootDir: dir, pending: [] });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });
});

// ── Real-corpus guard (the D16-18 regression assertion) ───────────
// The shipped corpus, with the three D16-10-pending collisions allowlisted at
// warning, must carry 0 ID-UNIQ ERRORS. This is the value-asserting test: it
// would FAIL (a) if a fourth, non-allowlisted command↔skill collision were
// introduced, or (b) if a D16-10 decommission landed but its allowlist entry
// were left stale (ID-UNIQ-STALE-ALLOWLIST). It passes today only because the
// allowlist exactly matches the live collision set.
describe("runValidator against the shipped corpus", () => {
  it("the repo's command/skill corpus has 0 id-uniqueness errors", async () => {
    const result = await runValidator();
    expect(result.errorCount, result.findings.map(formatFinding).join("\n")).toBe(0);
    expect(result.commandCount).toBeGreaterThan(0);
    expect(result.skillCount).toBeGreaterThan(0);
  });

  it("every allowlist entry corresponds to a live collision (no stale entries)", async () => {
    const result = await runValidator();
    const stale = result.findings.filter((f) => f.code === "ID-UNIQ-STALE-ALLOWLIST");
    expect(stale.map(formatFinding).join("\n")).toBe("");
  });

  it("the three known command↔skill twins are surfaced as pending warnings", async () => {
    const result = await runValidator();
    const pending = result.findings
      .filter((f) => f.code === "ID-UNIQ-COMMAND-SKILL-PENDING")
      .map((f) => f.baseId)
      .sort();
    expect(pending).toEqual([...PENDING_DECOMMISSION_BASE_IDS].sort());
  });
});
