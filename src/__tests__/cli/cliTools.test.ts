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

// MOCK: readManifest/writeManifest stubbed for the interaction-unit describe
// blocks below because those tests inject manifest-missing (null) and empty/
// populated cliTools shapes to drive picker/installer branch coverage in
// isolation — exercising the real fs round-trip in every branch would couple
// branch coverage to disk I/O. Per CONSTITUTION §2 P2 Decision 20 (real-deal-
// first), the schema-version-drift masking this mock would otherwise hide is
// closed by the "real manifest round-trip (Decision 20)" describe block at the
// bottom of this file, which un-mocks via vi.importActual and asserts the
// cliTools shape the command persists survives the real writeManifest →
// readManifest validator path.
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
// `npx hatch3r init` hint, CONFIG_ERROR code; C8-D1-M5 mapped exit code 65
// EX_DATAERR via ERROR_CODE_TO_EXIT_CODE).

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
  // CONFIG_ERROR + sysexits exitCode=65 per CLAUDE.md P1 UX standards and
  // types.ts ERROR_CODE_TO_EXIT_CODE (C8-D1-M5: call sites no longer
  // hand-pick `1`).
  const commands: Array<[string, () => Promise<void>]> = [
    ["cliToolsCommand", cliToolsCommand],
    ["cliToolsListCommand", cliToolsListCommand],
    ["cliToolsInstallCommand", cliToolsInstallCommand],
    ["cliToolsDetectCommand", cliToolsDetectCommand],
  ];

  for (const [name, fn] of commands) {
    it(`${name}: throws HatchError(CONFIG_ERROR, central-map exitCode=65) when manifest is missing`, async () => {
      vi.mocked(readManifest).mockResolvedValue(null as never);

      await expect(fn()).rejects.toBeInstanceOf(HatchError);
      try {
        await fn();
        throw new Error("expected HatchError to be thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        const he = e as HatchError;
        expect(he.errorCode).toBe("CONFIG_ERROR");
        // C8-D1-M5: CONFIG_ERROR -> EX_DATAERR (65) via central map.
        expect(he.exitCode).toBe(65);
        expect(he.message).toContain(".hatch3r/hatch.json");
      }
    });

    it(`${name}: logs actionable error message naming the missing file`, async () => {
      vi.mocked(readManifest).mockResolvedValue(null as never);

      await expect(fn()).rejects.toBeInstanceOf(HatchError);
      // P1: actionable error names what failed (hatch.json missing).
      expect(vi.mocked(logError)).toHaveBeenCalledWith(
        expect.stringContaining(".hatch3r/hatch.json"),
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

// W5-bigfour --dry-run: behavioral no-write contract for the bare picker
// command (mirrors the init --dry-run block in init.test.ts).
describe("cliToolsCommand --dry-run no-write contract (W5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeManifest).mockResolvedValue(undefined);
  });

  it("--dry-run shows the would-be selection and writes NOTHING (no manifest write, no detection, no installer)", async () => {
    const manifest = makeManifest([]);
    vi.mocked(readManifest).mockResolvedValue(manifest);
    vi.mocked(pickCliTools).mockResolvedValue(["ripgrep", "fd"] as never);

    await cliToolsCommand({ dryRun: true });

    // No-write contract: no manifest persist, and the dry-run terminus
    // precedes the detection probe + installer offer + disclaimer entirely.
    expect(writeManifest).not.toHaveBeenCalled();
    expect(findMissingCliTools).not.toHaveBeenCalled();
    expect(offerInstaller).not.toHaveBeenCalled();
    expect(printMissingCliToolsDisclaimer).not.toHaveBeenCalled();
    // The in-memory manifest keeps its pre-picker cliTools shape.
    expect(manifest.cliTools).toEqual({ enabled: false, selected: [] });

    // The dry-run outcome box is emitted with the would-be selection.
    const call = vi.mocked(printBox).mock.calls.find((c) => c[0] === "CLI tools (dry-run)");
    expect(call).toBeDefined();
    expect(call?.[2]).toBe("info");
    const lines = (call?.[1] as string[]).join("\n");
    expect(lines).toContain("ripgrep");
    expect(lines).toContain("fd");
    expect(lines).toContain("not written");
  });
});

// F3.2-F2 (D3 Cycle 10 Wave 2): the describe blocks above stub readManifest/
// writeManifest, so a regression that breaks the real manifest writer — or one
// where cliToolsCommand builds a structurally invalid `cliTools` shape the real
// validateManifest would reject — would pass silently. Per CONSTITUTION §2 P2
// Decision 20 (real-deal-first) this block un-mocks the manifest module via
// vi.importActual and round-trips the exact `cliTools` shape the command writes
// (manifest.cliTools = { enabled, selected }) through the REAL writeManifest →
// readManifest path (which runs validateManifest on both write and read).
// A schema-version drift or an invalid cliTools sub-schema now fails here.
describe("real manifest round-trip (Decision 20 real-deal-first)", () => {
  it("the cliTools shape the command persists survives real writeManifest → readManifest", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    // vi.importActual returns the real module, bypassing the top-of-file mock.
    const realManifest = await vi.importActual<
      typeof import("../../manifest/hatchJson.js")
    >("../../manifest/hatchJson.js");

    const root = await mkdtemp(join(tmpdir(), "hatch3r-clitools-real-"));
    try {
      // Build a baseline valid manifest, then attach the SAME cliTools shape
      // cliToolsCommand assigns at cliTools.ts:101-105.
      const manifest = realManifest.createManifest({
        platform: "github",
        owner: "acme",
        repo: "widget",
        tools: ["claude"],
        cliTools: { enabled: true, selected: ["ripgrep", "fd"] as never },
      });

      await realManifest.writeManifest(root, manifest);
      const reloaded = await realManifest.readManifest(root);

      expect(reloaded).not.toBeNull();
      // The cliTools sub-schema must survive the validateManifest gate on both
      // write and read — proving the persisted shape is structurally valid.
      expect(reloaded!.cliTools).toEqual({
        enabled: true,
        selected: ["ripgrep", "fd"],
      });
      // schemaVersion drift guard: the writer stamps version "3.0.0"; a future
      // bump that the reader's migrate path does not handle would surface here.
      expect(reloaded!.version).toBe("3.0.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a structurally invalid manifest is rejected by the real writeManifest validator (mask removed)", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const realManifest = await vi.importActual<
      typeof import("../../manifest/hatchJson.js")
    >("../../manifest/hatchJson.js");

    const root = await mkdtemp(join(tmpdir(), "hatch3r-clitools-bad-"));
    try {
      const manifest = realManifest.createManifest({
        platform: "github",
        owner: "acme",
        repo: "widget",
        tools: ["claude"],
        cliTools: { enabled: true, selected: ["ripgrep"] as never },
      });
      // Corrupt a validated field (`tools` must contain only VALID_TOOLS
      // strings — hatchJson.ts:256-258). Under the stubbed writeManifest the
      // whole cli-tools flow would persist this silently; the REAL writer runs
      // validateManifest and must reject it so the bug cannot reach disk.
      (manifest as unknown as { tools: unknown }).tools = ["not-a-real-tool"];

      await expect(realManifest.writeManifest(root, manifest)).rejects.toThrow(
        HatchError,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
