import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator } from "../validate-content-claims.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");

// ── Fixture: clone the live claim surface ───────────────────────────
//
// Cloning skills/ + commands/ (the scanned artifact classes), rules/ + agents/
// (writer-instruction evidence for agent-materialized stores), and src/ (the
// command registry: program.ts + src/cli/commands/ + store writers) keeps the
// fixture in lock-step with the corpus per the CL-2 D22-12 test contract: an
// unmodified clone is the green baseline, and each injection test ADDS exactly
// one uniquely-named synthetic skill, asserting only on that file's findings —
// so the shared clone stays valid across the sequential `it` blocks.

let rootDir: string;

beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "content-claims-"));
  for (const d of ["skills", "commands", "rules", "agents", "src"]) {
    await cp(join(REPO_ROOT, d), join(rootDir, d), { recursive: true });
  }
}, 120_000);

afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

async function addSkill(name: string, body: string): Promise<string> {
  const dir = join(rootDir, "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nid: ${name}\nname: ${name}\ntype: skill\ndescription: Test fixture\ntags: [maintenance]\n---\n${body}`,
    "utf-8",
  );
  return `skills/${name}/SKILL.md`;
}

describe("validate-content-claims", () => {
  it("PASSes the cloned live corpus (0 errors, 0 warnings)", async () => {
    const r = await runValidator({ rootDir });
    expect(r.findings, r.findings.map((f) => `${f.code} ${f.file}`).join("\n")).toEqual([]);
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
    expect(r.checkedFiles).toBeGreaterThan(50);
  });

  it("PASSes the actual repository root with 0 errors (the gate CI runs)", async () => {
    const r = await runValidator();
    const errors = r.findings.filter((f) => f.level === "error");
    expect(errors, errors.map((f) => `${f.code} ${f.file}`).join("\n")).toEqual([]);
    expect(r.errorCount).toBe(0);
    expect(r.checkedFiles).toBeGreaterThan(50);
  });

  it("ERRORs (PHANTOM-RUNTIME) on an injected own-flag execution table with no command backing", async () => {
    const rel = await addSkill(
      "hatch3r-phantomx",
      "# Phantomx\n\nRun `phantomx --auto` for unattended execution.\n\n" +
        "| Mode | Effect |\n|------|--------|\n| `--auto` | Run all steps unattended |\n" +
        "| `--dry-run` | Preview without writes |\n| `phantomx --resume` | Continue a run |\n",
    );
    const r = await runValidator({ rootDir });
    const hit = r.findings.find((f) => f.file === rel);
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("CONTENT-CLAIM-PHANTOM-RUNTIME");
    expect(hit?.level).toBe("error");
    expect(hit?.message).toMatch(/phantomx/);
  });

  it("stays green on bare slash-argument flag cells with no terminal-invocation stake (the /report shape)", async () => {
    const rel = await addSkill(
      "hatch3r-phantomq",
      "# Phantomq\n\n| Flag | Effect |\n|------|--------|\n| `--save` | Persist the output |\n" +
        "| `--verbose` | Add a timeline |\n| `gh pr list --paginate` | External binary row |\n",
    );
    const r = await runValidator({ rootDir });
    expect(r.findings.filter((f) => f.file === rel)).toEqual([]);
  });

  it("does NOT fire on a negated runtime disclaimer (remediated-recipe shape)", async () => {
    const rel = await addSkill(
      "hatch3r-phantomy",
      "# Phantomy\n\nhatch3r ships no phantomy-runner binary and no `.hatch3r/phantomy/` " +
        "materialization. It does not invoke a runtime.\n",
    );
    const r = await runValidator({ rootDir });
    expect(r.findings.filter((f) => f.file === rel)).toEqual([]);
  });

  it("ERRORs (PHANTOM-RUNTIME) on a non-negated self-provided runtime noun", async () => {
    const rel = await addSkill(
      "hatch3r-phantomz",
      "# Phantomz\n\nThe phantomz runner walks each step and executes it in order.\n",
    );
    const r = await runValidator({ rootDir });
    const hit = r.findings.find((f) => f.file === rel);
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("CONTENT-CLAIM-PHANTOM-RUNTIME");
    expect(hit?.level).toBe("error");
  });

  it("WARNs (PHANTOM-STORE) on a `.hatch3r/<x>/` reference with no writer", async () => {
    const rel = await addSkill(
      "hatch3r-phantomw",
      "# Phantomw\n\nRead earlier results from `.hatch3r/zzzorphan/` before starting.\n",
    );
    const r = await runValidator({ rootDir });
    const hit = r.findings.find((f) => f.file === rel);
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("CONTENT-CLAIM-PHANTOM-STORE");
    expect(hit?.level).toBe("warning");
    expect(hit?.message).toMatch(/zzzorphan/);
  });

  it("does NOT flag a backed artifact's flag table (registered terminal command)", async () => {
    // `init` is a program.ts `.command("init")` registration; a same-named
    // artifact with an own-flag table is a truthful runtime claim.
    const dir = join(rootDir, "skills", "hatch3r-init");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nid: hatch3r-init\ntype: skill\ndescription: Test fixture\ntags: [maintenance]\n---\n" +
        "# Init\n\nRun `init --force` to re-run.\n\n| Flag | Effect |\n|------|--------|\n" +
        "| `--force` | Overwrite |\n| `init --yes` | Non-interactive |\n",
      "utf-8",
    );
    const r = await runValidator({ rootDir });
    expect(r.findings.filter((f) => f.file === "skills/hatch3r-init/SKILL.md")).toEqual([]);
  });
});
