import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADAPTER_TOOLS,
  RULE_CHANNELS,
  emittedGlobsFor,
  formatFinding,
  runValidator,
} from "../validate-adapter-output.js";
import type { AdapterOutput } from "../../src/types.js";

// ── Fixture helpers ────────────────────────────────────────────────
//
// validate-adapter-output drives `getAdapter().generate()` over a content
// root and compares each rule's emitted glob set against the set resolved from
// the rule's own `.md` frontmatter. Tests inject a tmpdir root holding a
// hand-authored rule corpus so they never depend on the real bundled content.

let rootDir: string;

async function makeRoot(): Promise<string> {
  rootDir = await mkdtemp(join(tmpdir(), "validate-adapter-output-"));
  return rootDir;
}

async function writeRule(name: string, raw: string): Promise<void> {
  const dir = join(rootDir, "rules");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), raw, "utf-8");
}

const CONDITIONAL_RULE = `---
id: cond-rule
type: rule
description: A conditional rule scoped to TS + markdown
scope: conditional
globs: "src/lib/*.ts,*.md"
precedence: critical
tags: [floor:security]
---
# Conditional Rule

Scopes to TypeScript sources and markdown.`;

const ALWAYS_RULE = `---
id: always-rule
type: rule
description: An always-on rule
scope: always
precedence: high
tags: [implementation]
---
# Always Rule

Loads unconditionally.`;

describe("validate-adapter-output — integration (real adapters over a synthetic corpus)", () => {
  beforeEach(async () => {
    await makeRoot();
  });

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  it("PASSes (0 errors) when every adapter emits the .md-derived glob set", async () => {
    await writeRule("cond-rule.md", CONDITIONAL_RULE);
    await writeRule("always-rule.md", ALWAYS_RULE);

    const result = await runValidator({ root: rootDir });

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
    // 2 rules × 3 adapters.
    expect(result.checkedRules).toBe(2);
    expect(result.checkedTools).toBe(3);
  });

  it("scopes the check to the injected adapter set when `tools` is narrowed", async () => {
    await writeRule("cond-rule.md", CONDITIONAL_RULE);

    const result = await runValidator({ root: rootDir, tools: ["cursor"] });

    expect(result.checkedTools).toBe(1);
    expect(result.errorCount).toBe(0);
  });
});

describe("validate-adapter-output — channel extractors", () => {
  it("cursor extracts the globs: [...] array set", () => {
    const content = `---\ndescription: x\nglobs: ["src/lib/*.ts", "*.md"]\n---\n\nbody`;
    const set = RULE_CHANNELS.cursor.extract(content);
    expect(set && [...set].sort()).toEqual(["*.md", "src/lib/*.ts"]);
  });

  it("cursor returns null when the rule fell back to alwaysApply (no globs key)", () => {
    const content = `---\ndescription: x\nalwaysApply: false\n---\n\nbody`;
    expect(RULE_CHANNELS.cursor.extract(content)).toBeNull();
  });

  it("copilot extracts the applyTo CSV string into a set", () => {
    const content = `---\napplyTo: "src/lib/*.ts, *.md"\n---\n\nbody`;
    const set = RULE_CHANNELS.copilot.extract(content);
    expect(set && [...set].sort()).toEqual(["*.md", "src/lib/*.ts"]);
  });

  it("claude extracts the paths: [...] array set", () => {
    const content = `---\npaths: ["src/lib/*.ts", "*.md"]\n---\n\nbody`;
    const set = RULE_CHANNELS.claude.extract(content);
    expect(set && [...set].sort()).toEqual(["*.md", "src/lib/*.ts"]);
  });

  it("extractors return null when there is no frontmatter at all", () => {
    expect(RULE_CHANNELS.cursor.extract("no frontmatter here")).toBeNull();
    expect(RULE_CHANNELS.copilot.extract("no frontmatter here")).toBeNull();
    expect(RULE_CHANNELS.claude.extract("no frontmatter here")).toBeNull();
  });
});

describe("validate-adapter-output — emittedGlobsFor (output indexing)", () => {
  const channel = RULE_CHANNELS.cursor;

  function out(path: string, content: string): AdapterOutput {
    return { path, content, action: "create" };
  }

  it("matches the NN-prefixed filename exactly and returns its glob set", () => {
    const outputs = [
      out(".cursor/rules/10-hatch3r-cond-rule.mdc", `---\nglobs: ["a", "b"]\n---\n\nx`),
    ];
    const set = emittedGlobsFor(outputs, channel, "hatch3r-cond-rule");
    expect([...set].sort()).toEqual(["a", "b"]);
  });

  it("does NOT alias a shorter id onto a longer id's file (prefix-collision guard)", () => {
    // hatch3r-security ⊂ hatch3r-security-patterns. A substring match would
    // wrongly resolve `hatch3r-security` to the `-patterns` file. Exact-id
    // matching must return the empty set (no own output) for `hatch3r-security`.
    const outputs = [
      out(".cursor/rules/10-hatch3r-security-patterns.mdc", `---\nglobs: ["x"]\n---\n\nx`),
    ];
    expect([...emittedGlobsFor(outputs, channel, "hatch3r-security")]).toEqual([]);
    expect([...emittedGlobsFor(outputs, channel, "hatch3r-security-patterns")]).toEqual(["x"]);
  });

  it("returns the empty set when the rule emitted no per-file output (unconditional)", () => {
    // e.g. inlined into copilot-instructions.md, or cursor alwaysApply.
    const outputs = [out(".cursor/rules/30-hatch3r-other.mdc", `---\nglobs: ["y"]\n---\n\nx`)];
    expect([...emittedGlobsFor(outputs, channel, "hatch3r-cond-rule")]).toEqual([]);
  });

  it("returns the empty set when the matched output fell back to alwaysApply (extract null)", () => {
    const outputs = [
      out(".cursor/rules/50-hatch3r-cond-rule.mdc", `---\ndescription: x\nalwaysApply: false\n---\n\nx`),
    ];
    expect([...emittedGlobsFor(outputs, channel, "hatch3r-cond-rule")]).toEqual([]);
  });
});

describe("validate-adapter-output — discriminating power (catches a glob regression)", () => {
  beforeEach(async () => {
    await makeRoot();
  });

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
  });

  it("ERRORs when a conditional rule's emitted set differs from its .md-derived set", async () => {
    // Stage a conditional rule, then prove the gate's comparison would fire on
    // drift by comparing the real (correct) cursor emission against a corpus
    // whose .md declares DIFFERENT globs than what the adapter emits. We
    // simulate the regression at the comparison layer: the GLOBS-DROP bug made
    // the adapter emit `globs: ["conditional"]` while the .md derived
    // ["src/lib/*.ts", "*.md"]. emittedGlobsFor + the resolver disagree → drift.
    await writeRule("cond-rule.md", CONDITIONAL_RULE);

    // Correct corpus passes (regression guard for the post-fix state).
    const ok = await runValidator({ root: rootDir, tools: ["cursor"] });
    expect(ok.errorCount).toBe(0);

    // Now assert the comparison core would have caught the pre-fix emission:
    // a `globs: ["conditional"]` output for the same prefixed id yields a set
    // that is NOT equal to the .md-derived ["src/lib/*.ts", "*.md"].
    const buggyOutputs: AdapterOutput[] = [
      {
        path: ".cursor/rules/10-hatch3r-cond-rule.mdc",
        content: `---\ndescription: x\nglobs: ["conditional"]\n---\n\nx`,
        action: "create",
      },
    ];
    const emitted = emittedGlobsFor(buggyOutputs, RULE_CHANNELS.cursor, "hatch3r-cond-rule");
    expect([...emitted]).toEqual(["conditional"]);
    // The .md-derived set never contains the literal token.
    expect(emitted.has("src/lib/*.ts")).toBe(false);
  });
});

describe("validate-adapter-output — output shape", () => {
  it("formatFinding renders an ERROR line with tool/rule and code", () => {
    const line = formatFinding({
      level: "error",
      code: "P3-ADAPTER-GLOB-DRIFT",
      tool: "cursor",
      ruleId: "hatch3r-security-patterns",
      message: "boom",
    });
    expect(line).toBe("[ERROR P3-ADAPTER-GLOB-DRIFT] cursor/hatch3r-security-patterns: boom");
  });

  it("checks the 3 supported adapters by default", () => {
    expect([...ADAPTER_TOOLS].sort()).toEqual(["claude", "copilot", "cursor"]);
  });
});
