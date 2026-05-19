import { describe, it, expect, vi, beforeEach } from "vitest";
import { HatchError, type HatchManifest } from "../../types.js";

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
  pickCliTools: vi.fn(),
}));

vi.mock("../../cli/shared/ui.js", () => ({
  printBanner: vi.fn(),
  printBox: vi.fn(),
  createSpinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    warn: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  })),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  label: vi.fn((k: string, v: string) => `${k}: ${v}`),
  verbose: vi.fn(),
}));

vi.mock("../../cliTools/detect.js", () => ({
  detectCliTools: vi.fn(),
  findMissingCliTools: vi.fn(),
}));

vi.mock("../../cliTools/install.js", () => ({
  offerInstaller: vi.fn().mockResolvedValue(true),
  printMissingCliToolsDisclaimer: vi.fn(),
}));

import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { pickCliTools } from "../../cli/shared/pickers.js";
import { detectCliTools, findMissingCliTools } from "../../cliTools/detect.js";
import {
  offerInstaller,
  printMissingCliToolsDisclaimer,
} from "../../cliTools/install.js";
import {
  info,
  warn,
  error as logError,
  printBox,
  createSpinner,
} from "../../cli/shared/ui.js";
import {
  cliToolsCommand,
  cliToolsInstallCommand,
  cliToolsListCommand,
  cliToolsDetectCommand,
} from "../../cli/commands/cliTools.js";

function makeManifest(selected: string[] = []): HatchManifest {
  return {
    cliTools: { enabled: selected.length > 0, selected: selected as never },
  } as unknown as HatchManifest;
}

describe("cliToolsCommand end-of-flow disclaimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));
    vi.mocked(writeManifest).mockResolvedValue(undefined);
  });

  it("calls printMissingCliToolsDisclaimer when final detection still reports missing tools", async () => {
    vi.mocked(pickCliTools).mockResolvedValue(["ripgrep", "fd"] as never);
    vi.mocked(findMissingCliTools).mockResolvedValue(["ripgrep", "fd"] as never);

    await cliToolsCommand();

    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledTimes(1);
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledWith(["ripgrep", "fd"], 2);
  });

  it("does not call printMissingCliToolsDisclaimer when no tools are selected", async () => {
    vi.mocked(pickCliTools).mockResolvedValue([] as never);

    await cliToolsCommand();

    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
  });
});

describe("cliToolsInstallCommand end-of-flow disclaimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeManifest).mockResolvedValue(undefined);
    vi.mocked(offerInstaller).mockResolvedValue(true);
  });

  it("calls printMissingCliToolsDisclaimer after offerInstaller when tools remain missing", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep", "fd"]));
    vi.mocked(findMissingCliTools)
      .mockResolvedValueOnce(["ripgrep"] as never)
      .mockResolvedValueOnce(["ripgrep"] as never);

    await cliToolsInstallCommand();

    expect(offerInstaller).toHaveBeenCalledTimes(1);
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledTimes(1);
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledWith(["ripgrep"], 2);
  });

  it("does not call printMissingCliToolsDisclaimer when all tools already installed", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep"]));
    vi.mocked(findMissingCliTools).mockResolvedValue([] as never);

    await cliToolsInstallCommand();

    expect(offerInstaller).not.toHaveBeenCalled();
    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
  });
});

// C9-H8 (D3-3.2.2): coverage extensions — install success path, detect/--check
// reporting path, manifest-missing platform-mismatch error path, and
// HatchError formatting per CLAUDE.md P1 UX standards (actionable errors with
// `npx hatch3r init` hint, CONFIG_ERROR code, exitCode=1).

describe("cliToolsInstallCommand install success path (C9-H8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeManifest).mockResolvedValue(undefined);
    vi.mocked(offerInstaller).mockResolvedValue(true);
  });

  it("succeeds quietly and short-circuits when all selected tools already on PATH", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep", "jq"]));
    vi.mocked(findMissingCliTools).mockResolvedValue([] as never);

    await cliToolsInstallCommand();

    // P1 success behaviour: spinner reports success label, no installer offered.
    expect(offerInstaller).not.toHaveBeenCalled();
    // findMissingCliTools is invoked once (initial scan) — no second probe
    // because the disclaimer branch is skipped when nothing is missing.
    expect(vi.mocked(findMissingCliTools).mock.calls.length).toBe(1);
    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
  });

  it("offers installer and re-probes after offer for the final disclaimer", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep", "fd"]));
    // First call: initial detection — both missing.
    // Second call: post-offer re-probe — one resolved, one still missing.
    vi.mocked(findMissingCliTools)
      .mockResolvedValueOnce(["ripgrep", "fd"] as never)
      .mockResolvedValueOnce(["fd"] as never);

    await cliToolsInstallCommand();

    expect(offerInstaller).toHaveBeenCalledTimes(1);
    // Two findMissingCliTools calls: initial + post-offer re-probe.
    expect(vi.mocked(findMissingCliTools).mock.calls.length).toBe(2);
    // Disclaimer reports the remaining missing tool against the original
    // selection size (2), not the per-call missing count.
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledWith(["fd"], 2);
  });

  it("returns early with info hint when manifest has no selected tools", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));

    await cliToolsInstallCommand();

    expect(vi.mocked(info)).toHaveBeenCalledWith(
      expect.stringContaining("No CLI tools selected"),
    );
    expect(offerInstaller).not.toHaveBeenCalled();
    expect(findMissingCliTools).not.toHaveBeenCalled();
    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
  });
});

describe("cliToolsDetectCommand --check (read-only) reporting (C9-H8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early with info hint when no tools are selected (read-only no-op)", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));

    await cliToolsDetectCommand();

    expect(vi.mocked(info)).toHaveBeenCalledWith(
      expect.stringContaining("No CLI tools selected"),
    );
    expect(detectCliTools).not.toHaveBeenCalled();
    expect(vi.mocked(printBox)).not.toHaveBeenCalled();
  });

  it("reports success box and no warning when every selected tool is on PATH", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep", "jq"]));
    vi.mocked(detectCliTools).mockResolvedValue([
      { id: "ripgrep", probe: "rg", installed: true, path: "/usr/local/bin/rg" },
      { id: "jq", probe: "jq", installed: true, path: "/usr/local/bin/jq" },
    ] as never);

    await cliToolsDetectCommand();

    expect(vi.mocked(printBox)).toHaveBeenCalledTimes(1);
    const [, lines, variant] = vi.mocked(printBox).mock.calls[0];
    expect(variant).toBe("success");
    expect((lines as string[]).some((l) => l.includes("2/2"))).toBe(true);
    expect(vi.mocked(warn)).not.toHaveBeenCalled();
  });

  it("reports info box plus warn line when some tools are missing", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep", "fd", "jq"]));
    vi.mocked(detectCliTools).mockResolvedValue([
      { id: "ripgrep", probe: "rg", installed: true, path: "/usr/local/bin/rg" },
      { id: "fd", probe: "fd", installed: false, path: "" },
      { id: "jq", probe: "jq", installed: false, path: "" },
    ] as never);

    await cliToolsDetectCommand();

    const [, lines, variant] = vi.mocked(printBox).mock.calls[0];
    expect(variant).toBe("info");
    expect((lines as string[]).some((l) => l.includes("1/3"))).toBe(true);
    // P1 actionable next-step pointer must be present.
    expect((lines as string[]).some((l) => l.includes("hatch3r cli-tools install"))).toBe(true);
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("2 CLI tool"));
  });
});

describe("cliToolsListCommand status reporting (C9-H8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints the no-selection info box when manifest has no tools selected", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));

    await cliToolsListCommand();

    expect(detectCliTools).not.toHaveBeenCalled();
    expect(vi.mocked(printBox)).toHaveBeenCalledTimes(1);
    const [, lines, variant] = vi.mocked(printBox).mock.calls[0];
    expect(variant).toBe("info");
    expect((lines as string[]).some((l) => l.includes("no CLI tools selected"))).toBe(true);
    expect((lines as string[]).some((l) => l.includes("hatch3r cli-tools"))).toBe(true);
  });

  it("renders tier label and PATH status for each selected tool", async () => {
    vi.mocked(readManifest).mockResolvedValue(makeManifest(["ripgrep", "fd"]));
    vi.mocked(detectCliTools).mockResolvedValue([
      { id: "ripgrep", probe: "rg", installed: true, path: "/usr/local/bin/rg" },
      { id: "fd", probe: "fd", installed: false, path: "" },
    ] as never);

    await cliToolsListCommand();

    expect(vi.mocked(printBox)).toHaveBeenCalledTimes(1);
    const [, lines, variant] = vi.mocked(printBox).mock.calls[0];
    // Mixed installed state → info variant, not success.
    expect(variant).toBe("info");
    const flat = (lines as string[]).join("\n");
    expect(flat).toContain("ripgrep");
    expect(flat).toContain("fd");
    expect(flat).toContain("tier 1");
    expect(flat).toContain("/usr/local/bin/rg");
    expect(flat).toContain("not on PATH");
  });
});

describe("manifest-missing error path & P1 actionable formatting (C9-H8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Parametrised across every cli-tools subcommand: each one must surface the
  // same actionable hint via `error()` plus throw a HatchError carrying
  // CONFIG_ERROR + exitCode=1 per CLAUDE.md P1 UX standards and types.ts
  // ERROR_CODE_TO_EXIT_CODE.
  const commands: Array<[string, () => Promise<void>]> = [
    ["cliToolsCommand", cliToolsCommand],
    ["cliToolsListCommand", cliToolsListCommand],
    ["cliToolsInstallCommand", cliToolsInstallCommand],
    ["cliToolsDetectCommand", cliToolsDetectCommand],
  ];

  for (const [name, fn] of commands) {
    it(`${name}: throws HatchError(CONFIG_ERROR, exitCode=1) when manifest is missing`, async () => {
      vi.mocked(readManifest).mockResolvedValue(null as never);

      await expect(fn()).rejects.toBeInstanceOf(HatchError);
      try {
        await fn();
        throw new Error("expected HatchError to be thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        const he = e as HatchError;
        expect(he.errorCode).toBe("CONFIG_ERROR");
        expect(he.exitCode).toBe(1);
        expect(he.message).toContain(".agents/hatch.json");
      }
    });

    it(`${name}: logs actionable error message naming the missing file`, async () => {
      vi.mocked(readManifest).mockResolvedValue(null as never);

      await expect(fn()).rejects.toBeInstanceOf(HatchError);
      // P1: actionable error names what failed (hatch.json missing).
      expect(vi.mocked(logError)).toHaveBeenCalledWith(
        expect.stringContaining(".agents/hatch.json"),
      );
    });

    it(`${name}: short-circuits before any detection/picker call`, async () => {
      vi.mocked(readManifest).mockResolvedValue(null as never);

      await expect(fn()).rejects.toBeInstanceOf(HatchError);
      // Side-effect-free failure: no probes, no picker, no writes.
      expect(pickCliTools).not.toHaveBeenCalled();
      expect(detectCliTools).not.toHaveBeenCalled();
      expect(findMissingCliTools).not.toHaveBeenCalled();
      expect(writeManifest).not.toHaveBeenCalled();
    });
  }
});

describe("cliToolsCommand interactive picker flow (C9-H8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readManifest).mockResolvedValue(makeManifest([]));
    vi.mocked(writeManifest).mockResolvedValue(undefined);
  });

  it("persists empty selection and skips detection when user picks nothing", async () => {
    vi.mocked(pickCliTools).mockResolvedValue([] as never);

    await cliToolsCommand();

    expect(writeManifest).toHaveBeenCalledTimes(1);
    const [, manifestArg] = vi.mocked(writeManifest).mock.calls[0];
    expect((manifestArg as HatchManifest).cliTools).toEqual({
      enabled: false,
      selected: [],
    });
    expect(findMissingCliTools).not.toHaveBeenCalled();
    expect(offerInstaller).not.toHaveBeenCalled();
  });

  it("succeeds without offering installer when picked tools are already installed", async () => {
    vi.mocked(pickCliTools).mockResolvedValue(["ripgrep"] as never);
    // Initial probe: nothing missing. Final disclaimer probe: also nothing.
    vi.mocked(findMissingCliTools).mockResolvedValue([] as never);
    const spinner = {
      start: vi.fn(),
      succeed: vi.fn(),
      warn: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    };
    vi.mocked(createSpinner).mockReturnValue(spinner as never);

    await cliToolsCommand();

    expect(spinner.succeed).toHaveBeenCalledWith(
      expect.stringContaining("All 1 CLI tool"),
    );
    expect(offerInstaller).not.toHaveBeenCalled();
    expect(writeManifest).toHaveBeenCalledTimes(1);
    const [, manifestArg] = vi.mocked(writeManifest).mock.calls[0];
    expect((manifestArg as HatchManifest).cliTools).toEqual({
      enabled: true,
      selected: ["ripgrep"],
    });
    // Final disclaimer probe runs but disclaimer treats empty missing as no-op.
    expect(printMissingCliToolsDisclaimer).toHaveBeenCalledWith([], 1);
  });
});
