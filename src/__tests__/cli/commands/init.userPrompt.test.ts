// D20: dedicated tests for the post-init "create your first user artifact?"
// inquirer prompt added to runInit.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import inquirer from "inquirer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENTS_DIR = ".agents";

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

describe("init D20 post-init prompt (C8-D20)", () => {
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
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-d20-"));
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

  it("--yes mode skips the post-init prompt entirely (no inquirer call)", async () => {
    await initCommand({ yes: true, tools: "claude" });

    // No inquirer prompt should have fired at all on the --yes path. If the
    // post-init prompt regressed to firing without skip-guard, it would be
    // captured here.
    const inq = vi.mocked(inquirer.prompt);
    expect(inq).not.toHaveBeenCalled();

    // And the manifest should still be written (init succeeded).
    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.tools).toContain("claude");
  });

  it("interactive mode + decline ('false') prints the Tip pointer to /hatch3r-create", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // Queue all prompts for an interactive minimal flow.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ defaultBranch: "main" });
    inq.mockResolvedValueOnce({ projectType: "brownfield" });
    inq.mockResolvedValueOnce({ teamSize: "solo" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ enabled: true }); // worktree (claude)
    inq.mockResolvedValueOnce({ features: ["agents"] });
    // The new D20 prompt — decline.
    inq.mockResolvedValueOnce({ create: false });

    await initCommand({});

    const out = combinedOutput();
    expect(out).toContain("Tip");
    expect(out).toContain("/hatch3r-create");
  });

  it("interactive mode + accept ('true') prints the Run /hatch3r-create pointer", async () => {
    const inq = vi.mocked(inquirer.prompt);
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ defaultBranch: "main" });
    inq.mockResolvedValueOnce({ projectType: "brownfield" });
    inq.mockResolvedValueOnce({ teamSize: "solo" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ enabled: true });
    inq.mockResolvedValueOnce({ features: ["agents"] });
    // The new D20 prompt — accept.
    inq.mockResolvedValueOnce({ create: true });

    await initCommand({});

    const out = combinedOutput();
    expect(out).toContain("Run /hatch3r-create");
  });
});
