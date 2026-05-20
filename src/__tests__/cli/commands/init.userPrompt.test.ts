// Post-init tip line: unconditional Tip about /hatch3r-create. The previous
// confirm prompt was theater (both branches printed near-identical tips and
// neither created anything) — now collapsed to a single line.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import inquirer from "inquirer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Wave 6: manifest moved from .agents/hatch.json to .hatch3r/hatch.json.
const AGENTS_DIR = ".hatch3r";

// Mock inquirer so the prompt-driven branches are deterministic. Mirrors the
// pattern in src/__tests__/cli/init.test.ts.
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

describe("init post-init tip", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean }) => Promise<void>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../../cli/commands/init.js"));
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-tip-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function combinedOutput(): string {
    return [
      ...consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])),
    ].join("\n");
  }

  it("--yes mode fires no inquirer prompts and still writes the manifest", async () => {
    await initCommand({ yes: true, tools: "claude" });

    const inq = vi.mocked(inquirer.prompt);
    expect(inq).not.toHaveBeenCalled();

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.tools).toContain("claude");
  });

  it("interactive mode prints the /hatch3r-create tip exactly once", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // Queue all prompts for an interactive minimal flow. C9-H28
    // (D10-SA10.3-F1) moved features + MCP ahead of the CLI tools picker.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ defaultBranch: "main" });
    inq.mockResolvedValueOnce({ projectType: "brownfield" });
    inq.mockResolvedValueOnce({ teamSize: "solo" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    // Slice D removed the interactive worktree confirm — auto-enabled when a
    // worktree-capable tool (claude) is selected.
    // Slice B: feature checkbox replaced by wantMcp confirm.
    inq.mockResolvedValueOnce({ wantMcp: false });
    inq.mockResolvedValueOnce({ tools: [] }); // C9-H28: CLI tools picker follows MCP

    await initCommand({});

    const out = combinedOutput();
    expect(out).toContain("Tip: Run /hatch3r-create");
    // Exactly one tip line — not two (the old accept/decline branches both
    // printed a tip).
    const matches = out.match(/Tip: Run \/hatch3r-create/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
