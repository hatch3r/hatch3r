/**
 * Tests for the SessionStart registry summarizer (C9-H77).
 *
 * Why these tests exist
 * ---------------------
 * The original SessionStart hook embedded inline Python that assumed the
 * v1 flat-array registry shape. When the registry migrated to v2
 * (`{ schema_version, entries: [...] }`), the inline parser silently
 * failed via `|| echo 'Registry not found'`, hiding the real state from
 * every session. The fix moves the parsing logic into
 * `src/hooks/sessionStartRegistry.ts` (this file's subject) and a
 * standalone Node script at `.claude/hooks/session-start-registry.mjs`.
 *
 * These tests pin the v2 parser against representative fixture shapes so
 * a future schema bump can't regress silently again.
 *
 * Pillars: P5 (Governance Self-Quality), P2 (Scientific Quality)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractCycle,
  summarizeRegistry,
  formatSummary,
  readAndSummarize,
  type RegistryEntry,
  type RegistryV2,
} from "../../hooks/sessionStartRegistry.js";

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    finding_id: "C9-H1",
    severity: "High",
    execution_status: "pending",
    wave: 2,
    ...overrides,
  };
}

function v2Registry(entries: RegistryEntry[]): RegistryV2 {
  return {
    schema_version: "2.0.0",
    entries,
  };
}

describe("extractCycle", () => {
  it("prefers explicit numeric cycle field", () => {
    expect(extractCycle({ cycle: 9, finding_id: "C7-H1" })).toBe(9);
  });

  it("falls back to finding_id prefix when cycle field absent", () => {
    expect(extractCycle({ finding_id: "C9-H77" })).toBe(9);
    expect(extractCycle({ finding_id: "C8-D2-M3" })).toBe(8);
  });

  it("parses C7.5 fractional cycles as integer 7", () => {
    expect(extractCycle({ finding_id: "C7.5-H1" })).toBe(7);
  });

  it("returns null for legacy hash-prefixed ids without a cycle", () => {
    expect(extractCycle({ finding_id: "#1" })).toBeNull();
    expect(extractCycle({ finding_id: "#42" })).toBeNull();
  });

  it("returns null when finding_id is missing or non-string", () => {
    expect(extractCycle({})).toBeNull();
    expect(extractCycle({ finding_id: undefined })).toBeNull();
    expect(
      extractCycle({ finding_id: 123 as unknown as string }),
    ).toBeNull();
  });

  it("ignores non-finite cycle field and falls back to id parsing", () => {
    expect(
      extractCycle({ cycle: Number.NaN, finding_id: "C9-H1" }),
    ).toBe(9);
  });
});

describe("summarizeRegistry — v2 schema", () => {
  it("counts pending entries across all cycles", () => {
    const reg = v2Registry([
      entry({ finding_id: "C9-H1", execution_status: "pending" }),
      entry({ finding_id: "C9-H2", execution_status: "done" }),
      entry({ finding_id: "C8-H3", execution_status: "pending" }),
    ]);
    const s = summarizeRegistry(reg);
    expect(s.totalEntries).toBe(3);
    expect(s.pendingTotal).toBe(2);
  });

  it("identifies the highest-integer cycle as current", () => {
    const reg = v2Registry([
      entry({ finding_id: "C7-H1" }),
      entry({ finding_id: "C9-H1" }),
      entry({ finding_id: "C8-H1" }),
    ]);
    expect(summarizeRegistry(reg).currentCycle).toBe(9);
  });

  it("scopes pending count to current cycle", () => {
    const reg = v2Registry([
      entry({ finding_id: "C9-H1", execution_status: "pending" }),
      entry({ finding_id: "C9-H2", execution_status: "pending" }),
      entry({ finding_id: "C9-H3", execution_status: "done" }),
      entry({ finding_id: "C8-H1", execution_status: "pending" }),
    ]);
    const s = summarizeRegistry(reg);
    expect(s.currentCycle).toBe(9);
    expect(s.pendingTotal).toBe(3);
    expect(s.pendingCurrentCycle).toBe(2);
  });

  it("counts critical-severity entries in current cycle regardless of status", () => {
    const reg = v2Registry([
      entry({
        finding_id: "C9-C1",
        severity: "Critical",
        execution_status: "done",
      }),
      entry({
        finding_id: "C9-C2",
        severity: "Critical",
        execution_status: "pending",
      }),
      entry({
        finding_id: "C9-H1",
        severity: "High",
        execution_status: "pending",
      }),
      entry({
        finding_id: "C8-C1",
        severity: "Critical",
        execution_status: "pending",
      }),
    ]);
    const s = summarizeRegistry(reg);
    expect(s.criticalCurrentCycle).toBe(2);
  });

  it("returns zeroed summary for an empty entries array", () => {
    const s = summarizeRegistry(v2Registry([]));
    expect(s.totalEntries).toBe(0);
    expect(s.pendingTotal).toBe(0);
    expect(s.currentCycle).toBeNull();
    expect(s.pendingCurrentCycle).toBe(0);
    expect(s.criticalCurrentCycle).toBe(0);
    expect(s.schemaVersion).toBe("2.0.0");
  });
});

describe("summarizeRegistry — defensive parsing", () => {
  it("returns zeroed summary when entries is missing", () => {
    const s = summarizeRegistry({ schema_version: "2.0.0" });
    expect(s.totalEntries).toBe(0);
    expect(s.currentCycle).toBeNull();
    expect(s.schemaVersion).toBe("2.0.0");
  });

  it("returns zeroed summary when entries is not an array", () => {
    const s = summarizeRegistry({
      schema_version: "2.0.0",
      entries: "not-an-array" as unknown as RegistryEntry[],
    });
    expect(s.totalEntries).toBe(0);
  });

  it("treats top-level array (v1 shape) as having no entries — protects against silent v1 regression", () => {
    // If we ever accidentally hand the parser a v1 flat array, it should
    // NOT count those as entries — surfacing "0 entries" makes the schema
    // mismatch loud.
    const v1Shape = [entry()] as unknown as RegistryV2;
    const s = summarizeRegistry(v1Shape);
    expect(s.totalEntries).toBe(0);
    expect(s.schemaVersion).toBe("unknown");
  });

  it("reports schema_version='unknown' when missing", () => {
    const s = summarizeRegistry({ entries: [entry()] });
    expect(s.schemaVersion).toBe("unknown");
  });

  it("tolerates null and undefined top-level", () => {
    expect(summarizeRegistry(null).totalEntries).toBe(0);
    expect(summarizeRegistry(undefined).totalEntries).toBe(0);
  });
});

describe("formatSummary", () => {
  it("includes cycle suffix when current cycle is known", () => {
    const line = formatSummary({
      schemaVersion: "2.0.0",
      totalEntries: 415,
      pendingTotal: 82,
      currentCycle: 9,
      pendingCurrentCycle: 80,
      criticalCurrentCycle: 8,
    });
    expect(line).toBe(
      "Audit registry v2.0.0: 415 entries, 82 pending (Cycle 9: 80 pending, 8 critical)",
    );
  });

  it("omits cycle suffix when current cycle is null", () => {
    const line = formatSummary({
      schemaVersion: "2.0.0",
      totalEntries: 0,
      pendingTotal: 0,
      currentCycle: null,
      pendingCurrentCycle: 0,
      criticalCurrentCycle: 0,
    });
    expect(line).toBe("Audit registry v2.0.0: 0 entries, 0 pending");
  });

  it("is a single line — hook prints one line", () => {
    const line = formatSummary({
      schemaVersion: "2.0.0",
      totalEntries: 1,
      pendingTotal: 1,
      currentCycle: 9,
      pendingCurrentCycle: 1,
      criticalCurrentCycle: 0,
    });
    expect(line.split("\n")).toHaveLength(1);
  });
});

describe("readAndSummarize", () => {
  let tmp: string | null = null;

  afterEach(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it("reads a v2 fixture and returns the formatted summary line", async () => {
    tmp = await mkdtemp(join(tmpdir(), "hatch3r-c9h77-"));
    const path = join(tmp, "registry.json");
    const reg = v2Registry([
      entry({
        finding_id: "C9-H1",
        execution_status: "pending",
        severity: "High",
      }),
      entry({
        finding_id: "C9-C1",
        execution_status: "pending",
        severity: "Critical",
      }),
      entry({
        finding_id: "C8-H1",
        execution_status: "done",
        severity: "High",
      }),
    ]);
    await writeFile(path, JSON.stringify(reg), "utf8");

    const line = await readAndSummarize(path);
    expect(line).toBe(
      "Audit registry v2.0.0: 3 entries, 2 pending (Cycle 9: 2 pending, 1 critical)",
    );
  });

  it("throws ENOENT when the registry file does not exist", async () => {
    await expect(
      readAndSummarize("/nonexistent/path/to/registry.json"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws SyntaxError when the registry is not valid JSON", async () => {
    tmp = await mkdtemp(join(tmpdir(), "hatch3r-c9h77-"));
    const path = join(tmp, "broken.json");
    await writeFile(path, "{ not valid json", "utf8");

    await expect(readAndSummarize(path)).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("dev-env ConfigChange hook wiring (D19-SA19.4-01 regression)", () => {
  // The ConfigChange config-tamper guard documents watching the PROJECT
  // .claude/settings.json (a committed, shared-team file — .claude/README.md).
  // Per the Claude Code hooks reference the ConfigChange matcher selects a
  // configuration SOURCE: `project_settings` = the project .claude/settings.json,
  // `user_settings` = the user-global ~/.claude/settings.json. Binding the guard
  // to user_settings meant it never fired on the file its message names.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const settingsPath = join(repoRoot, ".claude", "settings.json");

  async function readConfigChangeEntry(): Promise<{
    matcher?: string;
    command?: string;
  }> {
    const raw = await readFile(settingsPath, "utf8");
    const settings = JSON.parse(raw) as {
      hooks?: {
        ConfigChange?: Array<{
          matcher?: string;
          hooks?: Array<{ command?: string }>;
        }>;
      };
    };
    const entry = settings.hooks?.ConfigChange?.[0];
    return { matcher: entry?.matcher, command: entry?.hooks?.[0]?.command };
  }

  it("binds the ConfigChange guard to project_settings, not user_settings", async () => {
    const { matcher } = await readConfigChangeEntry();
    expect(matcher).toBe("project_settings");
  });

  it("keeps the guard's matcher target and message coherent", async () => {
    const { matcher, command } = await readConfigChangeEntry();
    expect(matcher).toBe("project_settings");
    expect(command ?? "").toContain(".claude/settings.json");
  });
});
