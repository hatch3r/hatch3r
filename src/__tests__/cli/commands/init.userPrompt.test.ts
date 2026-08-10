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

// CI determinism: interactive init calls findMissingCliTools (real PATH probe)
// then offerInstaller (an extra inquirer.prompt) for any tool absent from PATH.
// On a clean CI runner the selected tools are missing, so that extra prompt
// fires and shifts every test's queued inquirer answer by one. Mock detection
// to "nothing missing" so the prompt sequence is machine-independent. Mirrors
// src/__tests__/cli/config.test.ts:177.
vi.mock("../../../cliTools/detect.js", () => ({
  findMissingCliTools: vi.fn().mockResolvedValue([]),
  detectCliTool: vi.fn(),
  detectCliTools: vi.fn().mockResolvedValue([]),
  probeBin: vi.fn().mockResolvedValue(""),
}));

// D3-SA3.2-15 (D3, P5/CQ5): silence ONLY the ora spinner. createSpinner writes
// progress chrome ("[1/4] Resolving canonical content… ✔") to raw process.stderr
// (src/cli/shared/ui.ts pins the ora stream to stderr), so it bypasses the
// console spies below and interleaves with the vitest reporter stream. Partial-
// mock so createSpinner is a no-op while info()/isQuiet()/every other ui export
// stays real — the tip assertion here (info → console.log) depends on that.
vi.mock("../../../cli/shared/ui.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../cli/shared/ui.js")>();
  return {
    ...actual,
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
      stop: vi.fn(),
      info: vi.fn(),
      stopAndPersist: vi.fn(),
      clear: vi.fn(),
      text: "",
    })),
  };
});

// D3-SA3.2-11 (D3, CQ5 / P1) / CI-RECON-04: init's interactive flow now refuses
// to run when stdin is not a TTY (non-TTY preflight, src/cli/commands/init.ts).
// Under vitest stdin is not a TTY, so the interactive tip test below would trip
// that guard before reaching its mocked prompts. Force `process.stdin.isTTY =
// true` per test and restore it afterwards — the established pattern from
// src/__tests__/cli/init.test.ts's file-level hook. `--yes` short-circuits the
// gate, so the headless test is unaffected either way.
let savedStdinIsTTY: boolean | undefined;
beforeEach(() => {
  savedStdinIsTTY = process.stdin.isTTY;
  (process.stdin as { isTTY?: boolean }).isTTY = true;
});
afterEach(() => {
  if (savedStdinIsTTY === undefined) {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  } else {
    (process.stdin as { isTTY?: boolean }).isTTY = savedStdinIsTTY;
  }
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

  it("interactive mode prints the adapter-native hatch3r-create tip exactly once", async () => {
    const inq = vi.mocked(inquirer.prompt);
    // F10.3-2 (D10, P1): the interactive first-run flow is capped at the
    // ≤6-prompt ceiling — platform, identity, preset, maturity, tools, and
    // (W3-mcp-optin) the CLI-tools picker (pickCliTools answers under
    // `name: "tools"`; the queue is order-based). defaultBranch / projectType /
    // teamSize resolve from smart defaults; MCP is opt-in via --mcp, never
    // prompted. 2.1.0 (Decision 25) raised the ceiling 5→6 to add maturity.
    inq.mockResolvedValueOnce({ platform: "github" });
    inq.mockResolvedValueOnce({ owner: "o", repo: "r" });
    inq.mockResolvedValueOnce({ preset: "minimal" });
    inq.mockResolvedValueOnce({ maturity: "solo" });
    // release/2.8.5: communication-style prompt follows maturity.
    inq.mockResolvedValueOnce({ communicationStyle: "plain" });
    inq.mockResolvedValueOnce({ tools: ["claude"] });
    inq.mockResolvedValueOnce({ tools: [] });

    await initCommand({});

    const out = combinedOutput();
    expect(out).toContain("Tip: Run /hatch3r-create");
    // Exactly one tip line — not two (the old accept/decline branches both
    // printed a tip).
    const matches = out.match(/Tip: Run \/hatch3r-create/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
