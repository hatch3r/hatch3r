import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildInventory,
  checkDanglingDomainAgentRefs,
  checkEnumerationDrift,
  checkMarketplaceDescriptionDrift,
  checkOrphanAgents,
  checkStaleTokens,
  reconcileLastUpdated,
  sameInventoryContent,
  readExistingInventory,
  type InventoryDocument,
} from "../inventory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const COMMITTED_INVENTORY = join(ROOT, "governance", "inventory.json");

// ── Fixture helpers ────────────────────────────────────────────────

function makeDoc(
  overrides: Partial<InventoryDocument> = {},
): InventoryDocument {
  return {
    lastUpdated: "2026-01-01",
    counts: {
      adapters: 3,
      agents: 29,
      skills: 53,
      cliSkills: 6,
      rules: 65,
      rulesMdc: 65,
      commands: 30,
      hooks: 7,
      pipeline: 22,
      cliCommands: 18,
      agentsModes: 21,
      agentsShared: 13,
      commandsBoard: 11,
      commandsRevision: 4,
      checks: 6,
      githubAgents: 4,
      testFiles: 2,
    },
    files: {
      adapters: ["claude.ts", "copilot.ts", "cursor.ts"],
      agents: ["hatch3r-implementer.md"],
      skills: ["hatch3r-foo/SKILL.md"],
      cliSkills: [],
      rules: ["hatch3r-bar.md"],
      rulesMdc: ["hatch3r-bar.mdc"],
      commands: ["hatch3r-baz.md"],
      hooks: ["hatch3r-hook.md"],
      pipeline: ["foo.ts"],
      cliCommands: ["init.ts"],
      agentsModes: ["mode.md"],
      agentsShared: ["shared.md"],
      commandsBoard: ["board.md"],
      commandsRevision: ["rev.md"],
      checks: ["security.md"],
      githubAgents: ["agent.md"],
      testFiles: ["scripts/__tests__/foo.test.ts", "src/__tests__/bar.test.ts"],
    },
    ...overrides,
  };
}

describe("inventory: reconcileLastUpdated (preserve-unless-changed)", () => {
  it("(a) PRESERVES the committed lastUpdated when content is unchanged, even though 'today' differs", () => {
    const existing = makeDoc({ lastUpdated: "2026-06-04" });
    // Fresh build stamped with a LATER day, identical content otherwise.
    const fresh = makeDoc({ lastUpdated: "2026-09-30" });

    const result = reconcileLastUpdated(fresh, existing);

    expect(result.lastUpdated).toBe("2026-06-04");
    // The rest of the document is the freshly-built content (here identical).
    expect(result.counts).toEqual(fresh.counts);
    expect(result.files).toEqual(fresh.files);
  });

  it("(b) ADVANCES lastUpdated to 'today' when a count changes", () => {
    const existing = makeDoc({ lastUpdated: "2026-06-04" });
    const fresh = makeDoc({
      lastUpdated: "2026-09-30",
      counts: { ...existing.counts, rules: 66 },
    });

    const result = reconcileLastUpdated(fresh, existing);

    expect(result.lastUpdated).toBe("2026-09-30");
    expect(result.counts.rules).toBe(66);
  });

  it("(b) ADVANCES lastUpdated to 'today' when a file list changes", () => {
    const existing = makeDoc({ lastUpdated: "2026-06-04" });
    const fresh = makeDoc({
      lastUpdated: "2026-09-30",
      files: { ...existing.files, rules: ["hatch3r-bar.md", "hatch3r-new.md"] },
    });

    const result = reconcileLastUpdated(fresh, existing);

    expect(result.lastUpdated).toBe("2026-09-30");
  });

  it("keeps 'today' when there is no committed file (first generation)", () => {
    const fresh = makeDoc({ lastUpdated: "2026-09-30" });
    const result = reconcileLastUpdated(fresh, null);
    expect(result.lastUpdated).toBe("2026-09-30");
  });
});

describe("inventory: sameInventoryContent", () => {
  it("ignores lastUpdated when comparing", () => {
    const a = makeDoc({ lastUpdated: "2020-01-01" });
    const b = makeDoc({ lastUpdated: "2030-12-31" });
    expect(sameInventoryContent(a, b)).toBe(true);
  });

  it("detects a counts difference", () => {
    const a = makeDoc();
    const b = makeDoc({ counts: { ...makeDoc().counts, hooks: 8 } });
    expect(sameInventoryContent(a, b)).toBe(false);
  });

  it("detects a files difference", () => {
    const a = makeDoc();
    const b = makeDoc({
      files: { ...makeDoc().files, hooks: ["hatch3r-hook.md", "extra.md"] },
    });
    expect(sameInventoryContent(a, b)).toBe(false);
  });
});

describe("inventory: readExistingInventory", () => {
  it("returns null for a missing file (ENOENT)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inventory-read-"));
    try {
      const result = await readExistingInventory(join(dir, "nope.json"));
      expect(result).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a malformed JSON file (self-heals to today)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inventory-read-"));
    try {
      const path = join(dir, "inventory.json");
      await writeFile(path, "{ not valid json", "utf-8");
      const result = await readExistingInventory(path);
      expect(result).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses a well-formed committed file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inventory-read-"));
    try {
      const path = join(dir, "inventory.json");
      const doc = makeDoc({ lastUpdated: "2026-06-04" });
      await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
      const result = await readExistingInventory(path);
      expect(result?.lastUpdated).toBe("2026-06-04");
      expect(result?.counts.rules).toBe(65);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("inventory: buildInventory (injectable date)", () => {
  it("stamps the injected 'today' verbatim", async () => {
    const doc = await buildInventory("2099-12-31");
    expect(doc.lastUpdated).toBe("2099-12-31");
  });

  it("no-op regen against the real committed inventory is content-identical (gate stays green on any date)", async () => {
    // Proves the CI drift gate (.github/workflows/ci.yml: npm run inventory &&
    // git diff --exit-code) only fires on real content drift: a fresh build
    // stamped with a DIFFERENT day reconciles back to the committed bytes.
    const committed = JSON.parse(
      await readFile(COMMITTED_INVENTORY, "utf-8"),
    ) as InventoryDocument;

    const fresh = await buildInventory("2099-12-31");
    expect(sameInventoryContent(fresh, committed)).toBe(true);

    const reconciled = reconcileLastUpdated(fresh, committed);
    expect(reconciled.lastUpdated).toBe(committed.lastUpdated);
    // Full document round-trips byte-for-byte to the committed copy. Normalize
    // line endings on both sides: `JSON.stringify` always emits `\n`, but a
    // Windows checkout could read the committed file with `\r\n` (the repo-root
    // `.gitattributes` forces LF, so this is defense-in-depth — keeps the byte
    // compare about content, not the platform's line-ending convention).
    const rendered = `${JSON.stringify(reconciled, null, 2)}\n`.replace(/\r\n/g, "\n");
    const committedRaw = (await readFile(COMMITTED_INVENTORY, "utf-8")).replace(/\r\n/g, "\n");
    expect(rendered).toBe(committedRaw);
  });
});

describe("inventory: checks companion exclusion (D5-50)", () => {
  // Cycle 11 D5-50: `checks/README.md` carries `type: documentation` and is a
  // self-excluded authoring guide — no adapter emits it
  // (BaseAdapter.processCompanionSubdir skips `type: documentation` + README.md,
  // D2-8). The inventory previously counted every `.md` under checks/, so it
  // read 6 against a real `type: check` count of 5. These assert the live build
  // now mirrors the adapter exclusion: README is gone, only the 5 typed checks
  // remain, and the count equals the file-list length.
  it("excludes checks/README.md (type: documentation) and counts the 5 real checks", async () => {
    const doc = await buildInventory("2099-01-01");
    const { checks } = doc.files;

    expect(checks).not.toContain("README.md");
    expect(doc.counts.checks).toBe(checks.length);
    expect(doc.counts.checks).toBe(5);
    // The five canonical type:check files, sorted — the exact emission set.
    expect(checks).toEqual([
      "accessibility.md",
      "code-quality.md",
      "performance.md",
      "security.md",
      "testing.md",
    ]);
  });

  it("keeps every non-documentation companion class intact (exclusion is type-gated, not blanket)", async () => {
    // The README exclusion must not strip real companion files: the other
    // companion dirs carry no `type: documentation` member, so their counts are
    // unchanged by the D5-50 filter. A non-zero count here proves the gate did
    // not over-prune.
    const doc = await buildInventory("2099-01-01");
    expect(doc.counts.agentsShared).toBeGreaterThan(0);
    expect(doc.counts.commandsBoard).toBeGreaterThan(0);
    expect(doc.files.checks.every((f) => f.endsWith(".md"))).toBe(true);
  });
});

describe("inventory: testFiles collector (D3-5)", () => {
  // Cycle 11 D3-5: D03 cited a then-absent `inventory.json.testFiles` array and a
  // stale hand-maintained count. These assert the collector now produces a real,
  // deterministic set equal to what `vitest.config.ts` DEFAULT_TEST_GLOB runs.
  it("collects the live vitest suite across both roots, sorted and slash-normalized", async () => {
    const doc = await buildInventory("2099-01-01");
    const { testFiles } = doc.files;

    // Non-empty and count agrees with the array length.
    expect(testFiles.length).toBeGreaterThan(0);
    expect(doc.counts.testFiles).toBe(testFiles.length);

    // Every entry is a vitest test/spec file (mirrors DEFAULT_TEST_GLOB).
    expect(
      testFiles.every((p) => /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/.test(p)),
    ).toBe(true);

    // Both configured roots are represented (src/ + scripts/), proving the walk
    // is not silently restricted to one tree (the vitest.config.ts caveat).
    expect(testFiles.some((p) => p.startsWith("src/__tests__/"))).toBe(true);
    expect(testFiles.some((p) => p.startsWith("scripts/__tests__/"))).toBe(true);

    // Deterministic: forward-slash separators (Windows-stable) and locale sort.
    expect(testFiles.every((p) => !p.includes("\\"))).toBe(true);
    const sorted = [...testFiles].sort((a, b) => a.localeCompare(b));
    expect(testFiles).toEqual(sorted);

    // No vendored or built artifacts leak in.
    expect(
      testFiles.some((p) => p.includes("node_modules") || p.startsWith("dist/")),
    ).toBe(false);

    // This file is itself a member — a concrete anchor that the walk reaches
    // scripts/__tests__/ and uses the canonical relative path the probe expects.
    expect(testFiles).toContain("scripts/__tests__/inventory.test.ts");
  });
});

describe("inventory: checkStaleTokens (D10-9 docs-currency probe)", () => {
  it("reports 0 hits against the committed website docs (no removed *-customize references)", async () => {
    // Cycle 11 D10-9: the four `*-customize` editor commands were retired in
    // v1.9.0 for the single `/hatch3r-customize` skill. This proves the live
    // docs carry none of the removed tokens, so the CI `--check-docs` gate is
    // green; a regression that reintroduces one would flip this to >0 hits.
    const hits = await checkStaleTokens();
    expect(hits).toEqual([]);
  });
});

describe("inventory: checkEnumerationDrift (D10-2 reference-page presence probe)", () => {
  it("reports 0 misses for the REAL committed corpus (every canonical id is documented)", async () => {
    // Cycle 11 D10-2: every agent/skill/rule/hook must appear on its website
    // reference page. Build the live file lists from the filesystem and assert
    // the live reference pages enumerate all of them — a green CI `--check-docs`.
    const doc = await buildInventory("2099-01-01");
    const misses = await checkEnumerationDrift(doc.files);
    expect(misses).toEqual([]);
  });

  it("reports a miss when a canonical id has no row on its reference page", async () => {
    // Synthetic: inject an id that cannot appear on agents.md. The probe must
    // surface it so an added-but-undocumented artifact fails the gate.
    const doc = await buildInventory("2099-01-01");
    const tampered = {
      ...doc.files,
      agents: [...doc.files.agents, "hatch3r-zzz-nonexistent-agent.md"],
    };
    const misses = await checkEnumerationDrift(tampered);
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({
      label: "agent",
      id: "hatch3r-zzz-nonexistent-agent.md",
      page: "website/docs/reference/agents.md",
    });
  });

  it("excludes detail-rules (agent-orchestration-detail) from the presence requirement", async () => {
    // The `*-detail` rule carries `detail_rule: true` and has no standalone
    // reference-page row by design; it must not be reported as a miss even
    // though rules.md never lists `agent-orchestration-detail`.
    const doc = await buildInventory("2099-01-01");
    const misses = await checkEnumerationDrift(doc.files);
    expect(
      misses.some((m) => m.id === "hatch3r-agent-orchestration-detail.md"),
    ).toBe(false);
  });
});

describe("inventory: checkMarketplaceDescriptionDrift (D17-8 external-surface count probe)", () => {
  it("reports 0 drift for the REAL committed marketplace description (counts match inventory)", async () => {
    // Cycle 11 D17-8: the marketplace/About description counts must equal
    // inventory.json. Build the live counts and assert the committed
    // docs/marketplace-submission.md description blurbs agree — green CI.
    const doc = await buildInventory("2099-01-01");
    const drifts = await checkMarketplaceDescriptionDrift(doc.counts);
    expect(drifts).toEqual([]);
  });

  it("reports drift when the marketplace description count disagrees with inventory", async () => {
    // Synthetic: claim an impossible rules count. The probe must flag the
    // marketplace blurb's real literal (66) against the injected expectation.
    const doc = await buildInventory("2099-01-01");
    const drifts = await checkMarketplaceDescriptionDrift({
      ...doc.counts,
      rules: 999,
    });
    const ruleDrift = drifts.find((d) =>
      d.label.includes("rules"),
    );
    expect(ruleDrift).toBeDefined();
    expect(ruleDrift).toMatchObject({ expected: 999, found: doc.counts.rules });
  });
});

describe("inventory: checkOrphanAgents (D16-11 orphaned-agent probe)", () => {
  it("reports 0 orphans for the REAL committed corpus (every agent has a functional consumer)", async () => {
    // Cycle 11 D16-11: an agent whose only inbound is the shared §0 registry
    // block (agents/shared/clarification-default-block.md) is orphaned. Build the
    // live agent list and assert each has at least one non-self, non-registry
    // consumer — a green CI `--check-docs`. The fix that wired
    // hatch3r-dependency-drafter into hatch3r-dep-audit's Required Agent
    // Delegation is what makes this pass; reverting that wiring flips it to 1.
    const doc = await buildInventory("2099-01-01");
    const orphans = await checkOrphanAgents(doc.files);
    expect(orphans).toEqual([]);
  });

  it("reports an orphan when an agent has no consumer outside the shared registry", async () => {
    // Synthetic: inject an agent id that no skill/command/rule/hook references.
    // The probe must surface it so a future orphan fails the gate at CI time.
    const doc = await buildInventory("2099-01-01");
    const tampered = {
      ...doc.files,
      agents: [...doc.files.agents, "hatch3r-zzz-orphan-agent.md"],
    };
    const orphans = await checkOrphanAgents(tampered);
    expect(orphans).toEqual([{ id: "hatch3r-zzz-orphan-agent" }]);
  });
});

describe("inventory: checkDanglingDomainAgentRefs (D23-8 + SA23.1-F5 dangling agent-ref probe)", () => {
  it("reports 0 dangling refs for the REAL committed domain files (every cited agents/hatch3r-*.md exists)", async () => {
    // Cycle 11 D23-8 + SA23.1-F5: audit-domain files cite agents as tabulation
    // targets; a citation to a non-existent agent mis-routes the audit SA. The
    // D23 fix repointed the dangling `hatch3r-verifier`/`hatch3r-planner` refs to
    // real eval/planning surfaces, so the live corpus must scan clean — a green
    // CI `--check-docs`. Reintroducing either dangling ref flips this to >0.
    const hits = await checkDanglingDomainAgentRefs();
    expect(hits).toEqual([]);
  });

  it("flags a citation whose target agent file is absent, ignoring existing ones", async () => {
    // Hermetic: a tmpdir with one agent file present and one domain file citing
    // both that agent (valid) and a non-existent one (dangling). The probe must
    // report only the dangling ref, deduped, with the domain-file repo-relative
    // path the CI message uses.
    const tmp = await mkdtemp(join(tmpdir(), "hatch3r-dangling-"));
    try {
      const agentsDir = join(tmp, "agents");
      const domainsDir = join(tmp, "domains");
      await mkdir(agentsDir, { recursive: true });
      await mkdir(domainsDir, { recursive: true });
      await writeFile(join(agentsDir, "hatch3r-reviewer.md"), "# reviewer\n");
      await writeFile(
        join(domainsDir, "D99-fixture.md"),
        "Tabulate against `agents/hatch3r-reviewer.md` and " +
          "`agents/hatch3r-verifier.md`; also `agents/hatch3r-verifier.md` again.\n",
      );
      const hits = await checkDanglingDomainAgentRefs({ agentsDir, domainsDir });
      expect(hits).toEqual([
        {
          file: join("governance", "audit", "domains", "D99-fixture.md"),
          ref: "hatch3r-verifier.md",
        },
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
