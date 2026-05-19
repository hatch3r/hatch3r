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
import { printBox, info, warn, error as logError } from "../../cli/shared/ui.js";
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

    expect(ensureEnvMcp).toHaveBeenCalledWith(expect.any(String), ["github", "context7"]);
    expect(ensureGitignoreEntry).toHaveBeenCalledTimes(1);

    // newVars present → warn() + info() must surface so the user knows
    // to fill in the new entry and re-source the env file.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GITHUB_PAT"));
    expect(info).toHaveBeenCalledWith(expect.stringContaining("source"));

    expect(printBox).toHaveBeenCalledWith(
      "MCP configured",
      expect.any(Array),
      "success",
    );
  });

  it("skips env-file work when the picker returns an empty selection", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"], "github"));
    vi.mocked(pickMcpServers).mockResolvedValue([]);

    await mcpSetupCommand();

    expect(writeManifest).toHaveBeenCalledTimes(1);
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

  it("throws HatchError(CONFIG_ERROR, exitCode 1) when no manifest exists", async () => {
    vi.mocked(readManifest).mockResolvedValue(null);

    await expect(mcpSetupCommand()).rejects.toThrow(HatchError);
    try {
      await mcpSetupCommand();
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(1);
      expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
    }

    expect(logError).toHaveBeenCalledWith(expect.stringContaining("No .agents/hatch.json"));
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

    expect(printBox).toHaveBeenCalledWith(
      "MCP server removed",
      expect.any(Array),
      "success",
    );
  });

  it("prints 'Remaining: none' when the last server is removed", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));

    await mcpRemoveCommand("github");

    const lines = (vi.mocked(printBox).mock.calls[0]?.[1] as string[]).join("\n");
    expect(lines).toMatch(/Remaining[^\w]*none/);
  });

  it("throws HatchError(VALIDATION_ERROR, exitCode 1) when the server is not configured", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["github"]));

    await expect(mcpRemoveCommand("brave-search")).rejects.toThrow(HatchError);
    try {
      await mcpRemoveCommand("brave-search");
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(1);
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
