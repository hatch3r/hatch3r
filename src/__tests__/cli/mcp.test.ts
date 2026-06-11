import { describe, it, expect, vi, beforeEach } from "vitest";
import { HatchError, type HatchManifest } from "../../types.js";

// ── Mock all external dependencies before imports ─────────────
//
// mcp.ts (src/cli/commands/mcp.ts) is a 4-subcommand side-door entry:
//   mcpSetupCommand | mcpListCommand | mcpRemoveCommand | mcpEnvCheckCommand
// Every subcommand reads the manifest first, exits via HatchError when
// the manifest is missing, and persists writes via `writeManifest`. The
// test file mocks all I/O surfaces so we exercise each handler's
// happy path + the well-defined error path without touching disk.

vi.mock("inquirer", () => {
  class Separator {
    constructor(public readonly line: string) {}
  }
  return {
    default: {
      prompt: vi.fn(),
      Separator,
    },
  };
});

// MOCK: readManifest/writeManifest stubbed for the per-subcommand describe
// blocks below because those tests drive picker / env-file / removal branch
// coverage in isolation and assert the manifest the handler passes to
// writeManifest — not the on-disk result. This file also globally mocks
// node:fs + node:fs/promises (existsSync/readFile), so a real writeManifest
// round-trip cannot run here without breaking that isolation. Per CONSTITUTION
// §2 P2 Decision 20 (real-deal-first), the schema-version-drift masking this
// mock would hide is closed by the companion file
// src/__tests__/cli/mcp.realManifest.test.ts, which carries no fs mocks and
// round-trips the exact mcp.servers shape these commands persist through the
// REAL writeManifest → readManifest validator path.
vi.mock("../../manifest/hatchJson.js", () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}));

vi.mock("../../cli/shared/pickers.js", () => ({
  pickMcpServers: vi.fn(),
}));

vi.mock("../../env/mcpEnv.js", () => ({
  ensureEnvMcp: vi.fn(),
  ensureGitignoreEntry: vi.fn(),
  getSourceEnvMcpCommand: vi.fn(() => "set -a && source .env.mcp && set +a"),
  parseEnvFile: vi.fn(),
  collectRequiredEnvVars: vi.fn(),
}));

vi.mock("../../cli/shared/ui.js", () => ({
  printBanner: vi.fn(),
  printBox: vi.fn(),
  // W5: commandOutput.ts (beginCommand/finishCommand) routes through these ui
  // exports, so the mock must cover the full surface it touches.
  printNextSteps: vi.fn(),
  printTimingSummary: vi.fn(),
  resetUiState: vi.fn(),
  setJson: vi.fn(),
  setQuiet: vi.fn(),
  setVerbose: vi.fn(),
  isQuiet: vi.fn().mockReturnValue(false),
  isJson: vi.fn().mockReturnValue(false),
  isVerbose: vi.fn().mockReturnValue(false),
  verbose: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  label: vi.fn((k: string, v: string) => `${k}: ${v}`),
}));

vi.mock("../../cli/shared/constants.js", () => ({
  isWSL: vi.fn(() => false),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// ── Import mocked modules ─────────────────────────────────────

import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { pickMcpServers } from "../../cli/shared/pickers.js";
import {
  ensureEnvMcp,
  ensureGitignoreEntry,
  parseEnvFile,
  collectRequiredEnvVars,
} from "../../env/mcpEnv.js";
import { printBox, warn, error as logError } from "../../cli/shared/ui.js";
import { isWSL } from "../../cli/shared/constants.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

// ── Import module under test ──────────────────────────────────

import {
  mcpSetupCommand,
  mcpListCommand,
  mcpRemoveCommand,
  mcpEnvCheckCommand,
} from "../../cli/commands/mcp.js";

// ── Helpers ───────────────────────────────────────────────────

/**
 * Minimal HatchManifest factory. Only fields read by mcp.ts are populated;
 * the rest are cast through `unknown` to keep test setup focused (same
 * pattern as cliTools.test.ts:60).
 */
function makeManifest(servers: string[] = [], platform: string = "github"): HatchManifest {
  return {
    platform,
    mcp: { servers },
  } as unknown as HatchManifest;
}

// ── mcpSetupCommand ───────────────────────────────────────────

describe("mcpSetupCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeManifest).mockResolvedValue(undefined);
    vi.mocked(isWSL).mockReturnValue(false);
  });

  it("opens picker, persists selection, and reports newly-required env vars", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([], "github"));
    vi.mocked(pickMcpServers).mockResolvedValue(["github", "context7"]);
    vi.mocked(ensureEnvMcp).mockResolvedValue({
      action: "created",
      path: ".env.mcp",
      newVars: ["GITHUB_PAT"],
    });
    vi.mocked(ensureGitignoreEntry).mockResolvedValue(undefined);

    await mcpSetupCommand();

    expect(pickMcpServers).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "github", existing: [] }),
    );
    expect(writeManifest).toHaveBeenCalledTimes(1);
    const writtenManifest = vi.mocked(writeManifest).mock.calls[0]?.[1] as HatchManifest;
    expect(writtenManifest.mcp.servers).toEqual(["github", "context7"]);
    // W3-mcp-optin: `mcp setup` flips features.mcp in lockstep with the server
    // list — DEFAULT_FEATURES.mcp is false (opt-in), and sync/update/validate/
    // adapters gate on `features.mcp && servers.length > 0`.
    expect(writtenManifest.features.mcp).toBe(true);

    expect(ensureEnvMcp).toHaveBeenCalledWith(expect.any(String), ["github", "context7"]);
    expect(ensureGitignoreEntry).toHaveBeenCalledTimes(1);

    // D10-M7 (Cycle 10): the env-var advisory moved INSIDE the success box
    // so users no longer miss it. Assert the env-var name and the source
    // command appear among the box's lines instead of `warn()` / `info()`.
    expect(warn).not.toHaveBeenCalled();
    const printBoxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "MCP configured");
    expect(printBoxCall).toBeDefined();
    const boxLines = (printBoxCall?.[1] ?? []) as string[];
    expect(boxLines.some((l) => l.includes("GITHUB_PAT"))).toBe(true);
    expect(boxLines.some((l) => l.includes("source") || l.includes(".env.mcp"))).toBe(true);
    expect(printBoxCall?.[2]).toBe("success");
  });

  it("skips env-file work when the picker returns an empty selection", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"], "github"));
    vi.mocked(pickMcpServers).mockResolvedValue([]);

    await mcpSetupCommand();

    expect(writeManifest).toHaveBeenCalledTimes(1);
    // W3-mcp-optin: an empty selection turns the derived feature flag off.
    const writtenManifest = vi.mocked(writeManifest).mock.calls[0]?.[1] as HatchManifest;
    expect(writtenManifest.features.mcp).toBe(false);
    expect(ensureEnvMcp).not.toHaveBeenCalled();
    expect(ensureGitignoreEntry).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when the env file already has every required var", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([], "github"));
    vi.mocked(pickMcpServers).mockResolvedValue(["github"]);
    vi.mocked(ensureEnvMcp).mockResolvedValue({
      action: "skipped",
      path: ".env.mcp",
      newVars: [],
    });
    vi.mocked(ensureGitignoreEntry).mockResolvedValue(undefined);

    await mcpSetupCommand();

    expect(warn).not.toHaveBeenCalled();
    expect(printBox).toHaveBeenCalledWith("MCP configured", expect.any(Array), "success");
  });

  it("throws HatchError(CONFIG_ERROR, central-map exitCode 65) when no manifest exists", async () => {
    vi.mocked(readManifest).mockResolvedValue(null);

    await expect(mcpSetupCommand()).rejects.toThrow(HatchError);
    try {
      await mcpSetupCommand();
    } catch (e) {
      // C8-D1-M5: CONFIG_ERROR resolves through ERROR_CODE_TO_EXIT_CODE to
      // sysexits.h EX_DATAERR (65). The call site no longer hand-picks `1`.
      expect((e as HatchError).exitCode).toBe(65);
      expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
    }

    expect(logError).toHaveBeenCalledWith(expect.stringContaining("No .hatch3r/hatch.json"));
    expect(pickMcpServers).not.toHaveBeenCalled();
    expect(writeManifest).not.toHaveBeenCalled();
  });

  it("passes a WSL-specific inquirer theme when running under WSL", async () => {
    vi.mocked(isWSL).mockReturnValue(true);
    vi.mocked(readManifest).mockResolvedValue(makeManifest([], "github"));
    vi.mocked(pickMcpServers).mockResolvedValue([]);

    await mcpSetupCommand();

    expect(pickMcpServers).toHaveBeenCalledWith(
      expect.objectContaining({ wslTheme: expect.any(Object) }),
    );
  });

  // W5-bigfour --dry-run: behavioral no-write contract (mirrors the init
  // --dry-run block in init.test.ts).
  it("--dry-run reports the would-be selection and writes NOTHING (no manifest write, no .env.mcp, features.mcp untouched)", async () => {
    const manifest = makeManifest([], "github");
    vi.mocked(readManifest).mockResolvedValue(manifest);
    vi.mocked(pickMcpServers).mockResolvedValue(["github"]);

    await mcpSetupCommand({ dryRun: true });

    // No-write contract: no manifest persist, no .env.mcp provisioning,
    // no .gitignore registration.
    expect(writeManifest).not.toHaveBeenCalled();
    expect(ensureEnvMcp).not.toHaveBeenCalled();
    expect(ensureGitignoreEntry).not.toHaveBeenCalled();
    // The in-memory manifest is not mutated either — the dry-run terminus
    // returns BEFORE the mcp/features assignments.
    expect(manifest.mcp.servers).toEqual([]);
    expect((manifest as { features?: unknown }).features).toBeUndefined();

    // The dry-run outcome box is emitted with the would-be state.
    const call = vi.mocked(printBox).mock.calls.find((c) => c[0] === "MCP setup (dry-run)");
    expect(call).toBeDefined();
    expect(call?.[2]).toBe("info");
    const lines = (call?.[1] as string[]).join("\n");
    expect(lines).toContain("github");
    expect(lines).toContain("features.mcp: true");
    expect(lines).toContain("not written");
  });
});

// ── mcpListCommand ────────────────────────────────────────────

describe("mcpListCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(parseEnvFile).mockReturnValue({});
    vi.mocked(collectRequiredEnvVars).mockReturnValue([]);
  });

  it("prints (no MCP servers configured) when the manifest list is empty", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));

    await mcpListCommand();

    expect(printBox).toHaveBeenCalledWith(
      "MCP servers",
      expect.arrayContaining([expect.stringContaining("(no MCP servers configured)")]),
      "info",
    );
  });

  it("lists each configured server and surfaces missing env vars", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue("" as never);
    vi.mocked(parseEnvFile).mockReturnValue({});
    vi.mocked(collectRequiredEnvVars).mockReturnValue([
      { name: "GITHUB_PAT", server: "github", comment: "PAT", url: "https://example" },
    ]);

    await mcpListCommand();

    const callArgs = vi.mocked(printBox).mock.calls[0];
    expect(callArgs?.[0]).toBe("MCP servers");
    const lines = (callArgs?.[1] as string[]).join("\n");
    expect(lines).toContain("github");
    // Required vars line must surface the missing var so the user has a
    // clear next-action (P1 actionable errors).
    expect(lines).toContain("GITHUB_PAT");
  });

  it("reports 'all required vars set' once every required var has a value", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue("GITHUB_PAT=ghp_xxxx" as never);
    vi.mocked(parseEnvFile).mockReturnValue({ GITHUB_PAT: "ghp_xxxx" });
    vi.mocked(collectRequiredEnvVars).mockReturnValue([
      { name: "GITHUB_PAT", server: "github", comment: "PAT", url: "" },
    ]);

    await mcpListCommand();

    const lines = (vi.mocked(printBox).mock.calls[0]?.[1] as string[]).join("\n");
    expect(lines).toContain("all required vars set");
  });

  it("throws HatchError when no manifest exists", async () => {
    vi.mocked(readManifest).mockResolvedValue(null);

    await expect(mcpListCommand()).rejects.toThrow(HatchError);
  });
});

// ── mcpRemoveCommand ──────────────────────────────────────────

describe("mcpRemoveCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeManifest).mockResolvedValue(undefined);
  });

  it("removes a configured server, persists the manifest, and prints success", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github", "context7"]));

    await mcpRemoveCommand("github");

    expect(writeManifest).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeManifest).mock.calls[0]?.[1] as HatchManifest;
    expect(written.mcp.servers).toEqual(["context7"]);
    // W3-mcp-optin: servers remain → features.mcp stays true.
    expect(written.features.mcp).toBe(true);

    expect(printBox).toHaveBeenCalledWith(
      "MCP server removed",
      expect.any(Array),
      "success",
    );
  });

  it("prints 'Remaining: none' and turns features.mcp off when the last server is removed", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));

    await mcpRemoveCommand("github");

    const lines = (vi.mocked(printBox).mock.calls[0]?.[1] as string[]).join("\n");
    expect(lines).toMatch(/Remaining[^\w]*none/);
    // W3-mcp-optin: removing the last server recomputes the derived flag off,
    // keeping the manifest consistent for sync/update/validate/adapters.
    const written = vi.mocked(writeManifest).mock.calls[0]?.[1] as HatchManifest;
    expect(written.mcp.servers).toEqual([]);
    expect(written.features.mcp).toBe(false);
  });

  it("throws HatchError(VALIDATION_ERROR, central-map exitCode 64) when the server is not configured", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));

    await expect(mcpRemoveCommand("brave-search")).rejects.toThrow(HatchError);
    try {
      await mcpRemoveCommand("brave-search");
    } catch (e) {
      // C8-D1-M5: VALIDATION_ERROR resolves to sysexits.h EX_USAGE (64). The
      // call site no longer hand-picks `1`.
      expect((e as HatchError).exitCode).toBe(64);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('"brave-search" is not configured'),
    );
    expect(writeManifest).not.toHaveBeenCalled();
  });

  it("throws HatchError when no manifest exists", async () => {
    vi.mocked(readManifest).mockResolvedValue(null);

    await expect(mcpRemoveCommand("github")).rejects.toThrow(HatchError);
    expect(writeManifest).not.toHaveBeenCalled();
  });

  // W5-bigfour --dry-run: behavioral no-write contract (mirrors the init
  // --dry-run block in init.test.ts).
  it("--dry-run reports the post-removal state and writes NOTHING (manifest + features.mcp untouched)", async () => {
    const manifest = makeManifest(["github", "context7"]);
    vi.mocked(readManifest).mockResolvedValue(manifest);

    await mcpRemoveCommand("github", { dryRun: true });

    expect(writeManifest).not.toHaveBeenCalled();
    // In-memory manifest untouched: full server list intact, no derived
    // features.mcp recompute — the dry-run terminus precedes both assignments.
    expect(manifest.mcp.servers).toEqual(["github", "context7"]);
    expect((manifest as { features?: unknown }).features).toBeUndefined();

    const call = vi.mocked(printBox).mock.calls.find((c) => c[0] === "MCP remove (dry-run)");
    expect(call).toBeDefined();
    expect(call?.[2]).toBe("info");
    const lines = (call?.[1] as string[]).join("\n");
    expect(lines).toContain("Would remove: github");
    expect(lines).toContain("context7");
    expect(lines).toContain("features.mcp: true");
  });
});

// ── mcpEnvCheckCommand ────────────────────────────────────────

describe("mcpEnvCheckCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(parseEnvFile).mockReturnValue({});
  });

  it("short-circuits with 'nothing to check' when no servers are configured", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));

    await mcpEnvCheckCommand();

    expect(printBox).toHaveBeenCalledWith(
      "MCP env check",
      expect.arrayContaining([expect.stringContaining("nothing to check")]),
      "info",
    );
  });

  it("reports each server with its required env vars when all are set", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue("GITHUB_PAT=ghp_xxxx" as never);
    vi.mocked(parseEnvFile).mockReturnValue({ GITHUB_PAT: "ghp_xxxx" });

    await mcpEnvCheckCommand();

    const callArgs = vi.mocked(printBox).mock.calls[0];
    expect(callArgs?.[0]).toBe("MCP env check");
    // All vars set → printBox style is "success" (final arg).
    expect(callArgs?.[2]).toBe("success");
    const lines = (callArgs?.[1] as string[]).join("\n");
    expect(lines).toContain("github");
  });

  it("flags missing env vars and surfaces a follow-up action", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(parseEnvFile).mockReturnValue({});

    await mcpEnvCheckCommand();

    const callArgs = vi.mocked(printBox).mock.calls[0];
    // Missing → printBox style is "info" (per mcp.ts:198).
    expect(callArgs?.[2]).toBe("info");
    const lines = (callArgs?.[1] as string[]).join("\n");
    expect(lines).toContain("missing: GITHUB_PAT");
    expect(lines).toContain("Action");
  });

  it("treats servers with no requiresEnv (e.g. context7) as no-env-needed", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["context7"]));

    await mcpEnvCheckCommand();

    const lines = (vi.mocked(printBox).mock.calls[0]?.[1] as string[]).join("\n");
    expect(lines).toContain("no env vars required");
  });

  it("throws HatchError when no manifest exists", async () => {
    vi.mocked(readManifest).mockResolvedValue(null);

    await expect(mcpEnvCheckCommand()).rejects.toThrow(HatchError);
  });
});

// F3.2-F2 (D3 Cycle 10 Wave 2): the real writeManifest → readManifest round-trip
// for the mcp.servers shape lives in the companion file
// src/__tests__/cli/mcp.realManifest.test.ts. It cannot live in this file
// because the node:fs / node:fs/promises mocks above (existsSync/readFile)
// would intercept the real manifest writer's fs calls. See that file for the
// real-deal coverage that closes the schema-version-drift masking.
