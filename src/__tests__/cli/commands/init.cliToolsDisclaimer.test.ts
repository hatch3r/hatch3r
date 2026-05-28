// Wave 2A (plan it-is-not-prominent-purring-phoenix): verify the
// `printMissingCliToolsDisclaimer` call sites that fire after the
// final `printBox("Hatch complete", ...)` and `printBox("Workspace
// ready", ...)` success boxes in `src/cli/commands/init.ts`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import inquirer from "inquirer";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

vi.mock("../../../cliTools/detect.js", () => ({
  findMissingCliTools: vi.fn(),
}));

vi.mock("../../../cliTools/install.js", () => ({
  offerInstaller: vi.fn(async () => undefined),
  printMissingCliToolsDisclaimer: vi.fn(),
}));

describe("init disclaimer after Hatch complete (repo)", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; cliTools?: string; noCliTools?: boolean }) => Promise<void>;
  let findMissingCliTools: ReturnType<typeof vi.fn>;
  let printMissingCliToolsDisclaimer: ReturnType<typeof vi.fn>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../../cli/commands/init.js"));
    ({ findMissingCliTools } = (await import("../../../cliTools/detect.js")) as unknown as {
      findMissingCliTools: ReturnType<typeof vi.fn>;
    });
    ({ printMissingCliToolsDisclaimer } = (await import("../../../cliTools/install.js")) as unknown as {
      printMissingCliToolsDisclaimer: ReturnType<typeof vi.fn>;
    });
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-disclaimer-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
    findMissingCliTools.mockReset();
    printMissingCliToolsDisclaimer.mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fires printMissingCliToolsDisclaimer with selected tools when some are missing", async () => {
    findMissingCliTools.mockResolvedValue(["ripgrep", "fd"]);

    await initCommand({ yes: true, cliTools: "ripgrep,fd,jq" });

    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledTimes(1);
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledWith(["ripgrep", "fd"], 3);
  });

  it("still calls disclaimer when all tools are detected (no-op pass-through)", async () => {
    findMissingCliTools.mockResolvedValue([]);

    await initCommand({ yes: true, cliTools: "ripgrep,jq" });

    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledTimes(1);
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledWith([], 2);
  });

  it("skips disclaimer entirely when no CLI tools are selected", async () => {
    findMissingCliTools.mockResolvedValue([]);

    await initCommand({ yes: true, noCliTools: true });

    expect(findMissingCliTools).not.toHaveBeenCalled();
    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
  });
});

describe("init disclaimer after Workspace ready", () => {
  let initCommand: (opts?: { tools?: string; yes?: boolean; cliTools?: string; noCliTools?: boolean }) => Promise<void>;
  let findMissingCliTools: ReturnType<typeof vi.fn>;
  let printMissingCliToolsDisclaimer: ReturnType<typeof vi.fn>;
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    ({ initCommand } = await import("../../../cli/commands/init.js"));
    ({ findMissingCliTools } = (await import("../../../cliTools/detect.js")) as unknown as {
      findMissingCliTools: ReturnType<typeof vi.fn>;
    });
    ({ printMissingCliToolsDisclaimer } = (await import("../../../cliTools/install.js")) as unknown as {
      printMissingCliToolsDisclaimer: ReturnType<typeof vi.fn>;
    });
  });

  async function createWorkspaceLayout(root: string, repos: string[]): Promise<void> {
    for (const name of repos) {
      await mkdir(join(root, name, ".git"), { recursive: true });
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-init-ws-disclaimer-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
    findMissingCliTools.mockReset();
    printMissingCliToolsDisclaimer.mockReset();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("workspace --yes path fires both runInit disclaimer and the workspace-level disclaimer", async () => {
    findMissingCliTools.mockResolvedValue(["jq"]);
    await createWorkspaceLayout(tempDir, ["repo-a", "repo-b"]);

    await initCommand({ yes: true, cliTools: "jq,ripgrep" });

    // Workspace mode delegates to runInit at the workspace root (first call site)
    // and also emits the workspace-level disclaimer (second call site).
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledTimes(2);
    expect(printMissingCliToolsDisclaimer).toHaveBeenNthCalledWith(1, ["jq"], 2);
    expect(printMissingCliToolsDisclaimer).toHaveBeenNthCalledWith(2, ["jq"], 2);
  });

  it("workspace --yes --no-cli-tools skips disclaimer at both call sites", async () => {
    await createWorkspaceLayout(tempDir, ["repo-a"]);

    await initCommand({ yes: true, noCliTools: true });

    expect(findMissingCliTools).not.toHaveBeenCalled();
    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
  });
});
