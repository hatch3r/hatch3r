import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildInventory,
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
