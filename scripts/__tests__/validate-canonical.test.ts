import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatFinding, runValidator, SCANNED_TYPES } from "../validate-canonical.js";

// ── Fixture helpers ────────────────────────────────────────────────
//
// validate-canonical drives readCanonicalFiles in strict mode against a
// content root. Tests inject a tmpdir root + a narrowed `types` set so they
// never depend on the real bundled corpus.

let rootDir: string;

async function makeRoot(): Promise<string> {
  rootDir = await mkdtemp(join(tmpdir(), "validate-canonical-"));
  return rootDir;
}

async function writeRule(root: string, name: string, raw: string): Promise<void> {
  const dir = join(root, "rules");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), raw, "utf-8");
}

const GOOD_RULE = "---\nid: good\ntype: rule\ndescription: ok\n---\n# OK";
// Unbalanced quote → YAML_PARSE_ERROR warning under the reader.
const BAD_RULE = `---\nid: bad\ntype: rule\ndescription: "unterminated\n---\n# Body`;

describe("validate-canonical", () => {
  beforeEach(async () => {
    await makeRoot();
  });

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  it("PASSes (0 errors) when every scanned type is warning-free", async () => {
    await writeRule(rootDir, "good.md", GOOD_RULE);

    const result = await runValidator({ root: rootDir, types: ["rules"] });

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedTypes).toBe(1);
  });

  it("ERRORs with P5-CANONICAL-WARN when a scanned type has a warning", async () => {
    await writeRule(rootDir, "good.md", GOOD_RULE);
    await writeRule(rootDir, "bad.md", BAD_RULE);

    const result = await runValidator({ root: rootDir, types: ["rules"] });

    const warn = result.findings.filter((f) => f.code === "P5-CANONICAL-WARN");
    expect(warn).toHaveLength(1);
    expect(warn[0].level).toBe("error");
    expect(warn[0].type).toBe("rules");
    expect(warn[0].message).toContain("YAML_PARSE_ERROR");
    expect(result.errorCount).toBe(1);
  });

  it("treats a missing/empty type directory as benign (no error)", async () => {
    // No directories created at all under root.
    const result = await runValidator({ root: rootDir, types: ["rules", "agents", "hooks"] });

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedTypes).toBe(3);
  });

  it("scans the published content classes by default", () => {
    // Locks the scanned-type contract: agents/checks/commands/github-agents/hooks/rules/skills.
    // github-agents added in D2-SA2.2-01 (Cycle 12) — a shipped, copilot-consumed class.
    expect([...SCANNED_TYPES].sort()).toEqual(
      ["agents", "checks", "commands", "github-agents", "hooks", "rules", "skills"],
    );
  });

  it("formatFinding renders an ERROR line with the type and code", () => {
    const line = formatFinding({
      level: "error",
      code: "P5-CANONICAL-WARN",
      type: "rules",
      message: "boom",
    });
    expect(line).toBe("[ERROR P5-CANONICAL-WARN] rules: boom");
  });
});
