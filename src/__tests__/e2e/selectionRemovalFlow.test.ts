// D10-SA10.6-01 (release/2.8.6) — end-to-end selection-removal flow against
// the REAL bundled corpus:
//
//   init-shaped manifest (custom selection) → generate + write to disk →
//   remove items from the selection → regenerate (files genuinely gone from
//   the output set) → orphan sweep unlinks the stale on-disk copies —
//   including a skill directory's SKILL.md via the new parent-dir sweep shape
//   → status/verify drift is clean and the removed artifacts are attributed
//   `not-selected`, never `unexplained`.
//
// This is the emission-side proof that a `hatch3r config` removal is no
// longer manifest-only bookkeeping. The CLI plumbing around this chain
// (consent prompts, snapshotting, summary boxes) is covered by the cli suites;
// this test drives the same seams those commands call — generate →
// safeWriteFile → sweepOrphansForAdapter → computeAdapterDrift — with the
// bookkeeping sync.ts performs (managedFiles / managedFilesByAdapter).

import { describe, it, expect, afterEach } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getAdapter } from "../../adapters/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { sweepOrphansForAdapter } from "../../merge/orphanCleanup.js";
import { computeAdapterDrift } from "../../cli/commands/status.js";
import type { ContentSelection, HatchManifest } from "../../types.js";

const RULE_PATH = ".claude/rules/50-hatch3r-git-conventions.md";
const SKILL_PATH = ".claude/skills/hatch3r-bug-fix/SKILL.md";
const COMMAND_PATH = ".claude/commands/hatch3r-ask.md";

function makeSelection(items: Partial<ContentSelection["items"]>): ContentSelection {
  return {
    preset: "custom",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: [],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
      ...items,
    },
  };
}

function makeManifest(content: ContentSelection): HatchManifest {
  return createManifest({
    tools: ["claude"],
    // Trim the surface to the three classes this flow exercises — keeps the
    // run fast and avoids the agents-class protected set entirely.
    features: { agents: false, githubAgents: false, hooks: false, prompts: false },
    content,
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    // Missing path is the expected outcome for this probe (same pattern as
    // the orphanCleanup unit suite's fileExists helper).
    void err;
    return false;
  }
}

describe("selection removal end-to-end (D10-SA10.6-01)", () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("remove → regenerate → sweep (incl. SKILL.md) → drift clean + not-selected attribution", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "hatch3r-e2e-selection-"));
    const canonicalRoot = resolveBundledContentRoot();

    // ── Phase 1: initial selection carries a rule, two skills, and a
    // command (cmd- form). hatch3r-customize is a PLAIN (non-protected)
    // skill kept as a selected member across both phases — it pins the
    // member-keep path. (Follow-up, out of this batch: a real-corpus
    // protected-bypass e2e would need features.agents: true and a protected
    // agent deliberately omitted from the selection.)
    const selectionA = makeSelection({
      rules: ["hatch3r-git-conventions"],
      skills: ["hatch3r-bug-fix", "hatch3r-customize"],
      commands: ["cmd-hatch3r-ask"],
    });
    const manifestA = makeManifest(selectionA);
    const adapter = getAdapter("claude");
    const outputsA = await adapter.generate(canonicalRoot, manifestA, rootDir);
    const pathsA = outputsA.map((o) => o.path);

    expect(pathsA).toContain(RULE_PATH);
    expect(pathsA).toContain(SKILL_PATH);
    expect(pathsA).toContain(COMMAND_PATH);
    // Non-selected artifacts of the filtered classes never enter the set.
    expect(pathsA.some((p) => /rules\/\d{2}-hatch3r-testing\.md$/.test(p))).toBe(false);

    for (const out of outputsA) {
      await safeWriteFile(join(rootDir, out.path), out.content, {
        managedContent: out.managedContent,
        appendIfNoBlock: true,
      });
    }
    expect(await fileExists(join(rootDir, RULE_PATH))).toBe(true);
    expect(await fileExists(join(rootDir, SKILL_PATH))).toBe(true);

    // ── Phase 2: the user removes the rule and the hatch3r-bug-fix skill.
    const selectionB = makeSelection({
      rules: [],
      skills: ["hatch3r-customize"],
      commands: ["cmd-hatch3r-ask"],
    });
    const manifestB = makeManifest(selectionB);
    const outputsB = await getAdapter("claude").generate(canonicalRoot, manifestB, rootDir);
    const pathsB = outputsB.map((o) => o.path);

    // The removed artifacts genuinely leave the output set.
    expect(pathsB).not.toContain(RULE_PATH);
    expect(pathsB).not.toContain(SKILL_PATH);
    // Still-selected members stay.
    expect(pathsB).toContain(COMMAND_PATH);
    expect(pathsB).toContain(".claude/skills/hatch3r-customize/SKILL.md");

    for (const out of outputsB) {
      await safeWriteFile(join(rootDir, out.path), out.content, {
        managedContent: out.managedContent,
        appendIfNoBlock: true,
      });
    }

    // ── Phase 3: the orphan sweep reclaims the stale on-disk copies — the
    // rule via the classic NN-hatch3r-* basename, the skill via the NEW
    // SKILL.md-under-hatch3r-parent recognition.
    const sweep = await sweepOrphansForAdapter("claude", rootDir, pathsA, pathsB);
    const swept = new Map(sweep.map((e) => [e.path, e]));
    expect(swept.get(RULE_PATH)?.reason).toBe("unlinked");
    expect(swept.get(SKILL_PATH)?.reason).toBe("unlinked");
    expect(await fileExists(join(rootDir, RULE_PATH))).toBe(false);
    expect(await fileExists(join(rootDir, SKILL_PATH))).toBe(false);
    // F6: the emptied hatch3r-owned skill directory is removed with it.
    expect(await fileExists(join(rootDir, ".claude/skills/hatch3r-bug-fix"))).toBe(false);
    // The kept command was re-emitted, is not an orphan candidate, and survives.
    expect(swept.has(COMMAND_PATH)).toBe(false);
    expect(await fileExists(join(rootDir, COMMAND_PATH))).toBe(true);

    // ── Phase 4: status/verify drift is clean under the post-removal
    // manifest (sync-style bookkeeping: track exactly the current paths).
    manifestB.managedFiles = [...pathsB];
    manifestB.managedFilesByAdapter = { claude: [...pathsB] };
    const report = await computeAdapterDrift(rootDir, manifestB);
    expect(report.counts.modified).toBe(0);
    expect(report.counts.missing).toBe(0);
    expect(report.counts.unexpected).toBe(0);

    // Emission-completeness attribution: the removed skill is `not-selected`
    // — an identified, informational reason — and NOTHING is `unexplained`.
    const gaps = report.emissionGaps ?? [];
    const bugFixGap = gaps.find((g) => g.id === "hatch3r-bug-fix" && g.contentClass === "skills");
    expect(bugFixGap).toBeDefined();
    expect(bugFixGap!.reason).toBe("not-selected");
    expect(gaps.filter((g) => g.reason === "unexplained")).toEqual([]);
    // The still-selected plain skill emits (ordinary member-keep) → no gap row.
    expect(gaps.find((g) => g.id === "hatch3r-customize")).toBeUndefined();
  }, 120_000);
});
