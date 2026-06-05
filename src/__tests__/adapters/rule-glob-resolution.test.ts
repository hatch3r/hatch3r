import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import {
  resolveRuleGlobs,
  csvToGlobList,
  readCanonicalFiles,
} from "../../adapters/canonical.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest, CanonicalFile } from "../../types.js";

/**
 * X4/CD4 (D6-1 / D9-1 / D11-1 — GLOBS DROP, Cycle 11 Wave 1).
 *
 * Regression guard for the centralized glob resolver. Canonical `.md` rules
 * declare `scope: conditional` + `globs: "<csv>"`; the real file patterns live
 * in the `globs:` field, not in `scope`. Before this fix, `canonical.ts` parsed
 * `globs` but never copied it onto the `CanonicalFile`, so `rule.globs` was
 * undefined downstream and all three adapters derived glob frontmatter from
 * `scope` alone — emitting the literal token `"conditional"` as a glob:
 *   - cursor:  `globs: ["conditional"]`
 *   - copilot: `applyTo: "conditional"`
 *   - claude:  dropped `paths:` entirely (loaded unconditionally)
 *
 * 52/65 conditional rules (incl. `floor:security` / `precedence: critical`
 * `hatch3r-security-patterns`) never auto-attached in Cursor/Copilot and loaded
 * unconditionally in Claude. These tests assert the emitted globs/applyTo/paths
 * equal the REAL derived set (computed via the shared `csvToGlobList`), never
 * `["conditional"]`.
 */

// Real-world shape: a multi-pattern conditional rule plus a single-pattern one.
const CONDITIONAL_GLOBS_CSV = "src/**/*.ts,*.md";
const EXPECTED_GLOBS = csvToGlobList(CONDITIONAL_GLOBS_CSV); // ["src/**/*.ts", "*.md"]

describe("resolveRuleGlobs (centralized glob resolver)", () => {
  function rule(partial: Partial<Pick<CanonicalFile, "scope" | "globs">>): Pick<CanonicalFile, "scope" | "globs"> {
    return { scope: partial.scope, globs: partial.globs };
  }

  it("resolves scope:conditional from the globs: field, not the scope token", () => {
    const result = resolveRuleGlobs(rule({ scope: "conditional", globs: CONDITIONAL_GLOBS_CSV }));
    expect(result).toEqual(["src/**/*.ts", "*.md"]);
    expect(result).not.toContain("conditional");
  });

  it("returns [] for scope:always (load unconditionally)", () => {
    expect(resolveRuleGlobs(rule({ scope: "always" }))).toEqual([]);
  });

  it("returns [] for scope:conditional with no globs: field (truly unconditional)", () => {
    // A conditional rule that forgot/omitted globs must NOT leak "conditional".
    expect(resolveRuleGlobs(rule({ scope: "conditional" }))).toEqual([]);
    expect(resolveRuleGlobs(rule({ scope: "conditional", globs: "" }))).toEqual([]);
  });

  it("returns [] for an absent/empty scope", () => {
    expect(resolveRuleGlobs(rule({}))).toEqual([]);
    expect(resolveRuleGlobs(rule({ scope: "" }))).toEqual([]);
  });

  it("parses legacy inline-CSV scope (back-compat) from the scope string itself", () => {
    // `scope: "src/**/*.ts,*.md"` — the deprecated inline form. Patterns live
    // in scope here; the validator's csvToSet derives the same set.
    expect(resolveRuleGlobs(rule({ scope: CONDITIONAL_GLOBS_CSV }))).toEqual(["src/**/*.ts", "*.md"]);
    // Single bare glob legacy form.
    expect(resolveRuleGlobs(rule({ scope: "**/*.ts" }))).toEqual(["**/*.ts"]);
  });

  it("honours a customization-layer scope override over the canonical scope", () => {
    // Override flips an always-rule into a conditional one via scope; with no
    // override globs the conditional resolves unconditional ([]).
    expect(
      resolveRuleGlobs(rule({ scope: "always", globs: CONDITIONAL_GLOBS_CSV }), { scope: "conditional" }),
    ).toEqual(["src/**/*.ts", "*.md"]);
    // Override scope to a legacy inline CSV wins over canonical conditional+globs.
    expect(
      resolveRuleGlobs(rule({ scope: "conditional", globs: CONDITIONAL_GLOBS_CSV }), { scope: "lib/**/*.js" }),
    ).toEqual(["lib/**/*.js"]);
  });

  it("de-duplicates and trims patterns, preserving first-seen order", () => {
    expect(resolveRuleGlobs(rule({ scope: "conditional", globs: " a , b , a , c " }))).toEqual(["a", "b", "c"]);
  });
});

describe("csvToGlobList mirrors validate-rule-parity csvToSet semantics", () => {
  it("strips a single layer of surrounding quotes", () => {
    expect(csvToGlobList('"a,b"')).toEqual(["a", "b"]);
    expect(csvToGlobList("'a,b'")).toEqual(["a", "b"]);
  });
  it("returns [] for empty/undefined", () => {
    expect(csvToGlobList(undefined)).toEqual([]);
    expect(csvToGlobList("")).toEqual([]);
    expect(csvToGlobList("   ")).toEqual([]);
  });
});

describe("adapter glob emission for scope:conditional rules (X4/CD4)", () => {
  let canonicalRoot: string;

  function makeManifest(tool: HatchManifest["tools"][number]): HatchManifest {
    return createManifest({ tools: [tool], mcpServers: [] });
  }

  beforeAll(async () => {
    canonicalRoot = await mkdtemp(join(tmpdir(), "hatch3r-glob-resolution-"));
    const rulesDir = join(canonicalRoot, "rules");
    await mkdir(rulesDir, { recursive: true });
    // Canonical two-line form: scope: conditional + globs: "<csv>".
    await writeFile(
      join(rulesDir, "cond-rule.md"),
      `---
id: cond-rule
type: rule
description: A conditional rule for glob-resolution testing
scope: conditional
globs: "${CONDITIONAL_GLOBS_CSV}"
tags: [floor:security]
precedence: critical
---
# Conditional Rule

This rule scopes to TypeScript sources and markdown files.`,
      "utf-8",
    );
  });

  afterAll(async () => {
    await rm(canonicalRoot, { recursive: true, force: true });
  });

  it("canonical.ts surfaces globs: onto the CanonicalFile (root-cause field)", async () => {
    const rules = await readCanonicalFiles(canonicalRoot, "rules");
    const cond = rules.find((r) => r.id === "cond-rule");
    expect(cond).toBeDefined();
    // The bug was a dropped field: globs parsed but never copied to CanonicalFile.
    expect(cond!.globs).toBe(CONDITIONAL_GLOBS_CSV);
    expect(cond!.scope).toBe("conditional");
    // And the resolver yields the real set, not the scope token.
    expect(resolveRuleGlobs(cond!)).toEqual(EXPECTED_GLOBS);
  });

  it("cursor emits the real glob set, never globs: [\"conditional\"]", async () => {
    const outputs = await new CursorAdapter().generate(canonicalRoot, makeManifest("cursor"));
    const ruleOut = outputs.find((o) => o.path.includes("cond-rule.mdc"));
    expect(ruleOut).toBeDefined();
    const content = ruleOut!.content;
    // Value-assert: exact frontmatter line with the resolved patterns.
    expect(content).toContain(`globs: [${EXPECTED_GLOBS.map((g) => `"${g}"`).join(", ")}]`);
    expect(content).toContain('"src/**/*.ts"');
    expect(content).toContain('"*.md"');
    // Regression: the literal token must never appear as a glob, and an
    // unconditional fallback must not be emitted for a genuinely scoped rule.
    expect(content).not.toContain('globs: ["conditional"]');
    expect(content).not.toContain("alwaysApply: true");
    // No adapter output for this scoped rule should carry the bare token.
    expect(content).not.toMatch(/globs:\s*\[[^\]]*"conditional"/);
  });

  it("copilot emits applyTo with the real glob set, never applyTo: \"conditional\"", async () => {
    const outputs = await new CopilotAdapter().generate(canonicalRoot, makeManifest("copilot"));
    // Scoped conditional rules go to per-file .github/instructions/, NOT inlined.
    const instr = outputs.find(
      (o) => o.path.startsWith(".github/instructions/") && o.path.includes("cond-rule"),
    );
    expect(instr).toBeDefined();
    const content = instr!.content;
    // VS Code applyTo is a single comma-separated glob string.
    expect(content).toContain(`applyTo: "${EXPECTED_GLOBS.join(", ")}"`);
    expect(content).not.toContain('applyTo: "conditional"');

    // And the rule must NOT have been mis-inlined into copilot-instructions.md
    // (which would mean it loads unconditionally instead of on matching files).
    const instructions = outputs.find((o) => o.path === ".github/copilot-instructions.md");
    expect(instructions).toBeDefined();
    expect(instructions!.content).not.toContain("A conditional rule for glob-resolution testing");
  });

  it("claude emits paths: with the real glob set for scope:conditional rules", async () => {
    const outputs = await new ClaudeAdapter().generate(canonicalRoot, makeManifest("claude"));
    const ruleOut = outputs.find((o) => o.path.includes("cond-rule.md") && o.path.startsWith(".claude/rules/"));
    expect(ruleOut).toBeDefined();
    const content = ruleOut!.content;
    // Before the fix, claude returned "" for scope:conditional → no paths:
    // frontmatter → rule loaded unconditionally. Now it lazy-loads on match.
    expect(content).toMatch(/^---\npaths: \["src\/\*\*\/\*\.ts", "\*\.md"\]\n---\n/);
    expect(content).not.toContain('paths: ["conditional"]');
    // paths: frontmatter precedes the managed block (frontmatter is unmanaged).
    expect(content.indexOf("paths:")).toBeGreaterThanOrEqual(0);
  });

  it("no adapter emits the literal token \"conditional\" as a glob anywhere", async () => {
    const adapters: Array<[HatchManifest["tools"][number], { generate: (r: string, m: HatchManifest) => Promise<{ content: string }[]> }]> = [
      ["cursor", new CursorAdapter()],
      ["copilot", new CopilotAdapter()],
      ["claude", new ClaudeAdapter()],
    ];
    for (const [tool, adapter] of adapters) {
      const outputs = await adapter.generate(canonicalRoot, makeManifest(tool));
      for (const out of outputs) {
        // The token may legitimately appear in prose (e.g. "conditional rules"),
        // so we only forbid it inside a glob/applyTo/paths emission shape.
        expect(out.content, `${tool} emitted "conditional" as a glob`).not.toMatch(
          /(?:globs|paths):\s*\[[^\]]*"conditional"[^\]]*\]/,
        );
        expect(out.content, `${tool} emitted applyTo: "conditional"`).not.toContain(
          'applyTo: "conditional"',
        );
      }
    }
  });
});
