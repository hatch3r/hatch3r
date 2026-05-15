import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { buildInstallPlan, offerInstaller, currentOsKey } from "../../cliTools/install.js";

/**
 * Wave 5 Item 28: behavioural tests for `src/cliTools/install.ts`.
 *
 * - buildInstallPlan: deterministic per-OS ordering.
 * - offerInstaller: non-interactive returns without prompting; interactive
 *   calls inquirer.confirm with the expected message text and default.
 */

vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

// Import after mock so the helper picks up our stub.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import inquirer from "inquirer";

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}
function restorePlatform(): void {
  Object.defineProperty(process, "platform", {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
}

describe("currentOsKey", () => {
  afterEach(() => {
    restorePlatform();
  });

  it("returns 'mac' for darwin", () => {
    setPlatform("darwin");
    expect(currentOsKey()).toBe("mac");
  });

  it("returns 'linux' for linux", () => {
    setPlatform("linux");
    expect(currentOsKey()).toBe("linux");
  });

  it("returns 'win' for win32", () => {
    setPlatform("win32");
    expect(currentOsKey()).toBe("win");
  });

  it("returns 'linux' for freebsd (apt fallback path)", () => {
    setPlatform("freebsd");
    expect(currentOsKey()).toBe("linux");
  });

  it("falls back to 'mac' for unknown platforms", () => {
    setPlatform("openbsd");
    expect(currentOsKey()).toBe("mac");
  });
});

describe("buildInstallPlan", () => {
  it("returns deterministic ordering matching the input id list (mac)", () => {
    const plan = buildInstallPlan(["ripgrep", "jq", "fd"], "mac");
    expect(plan.map((p) => p.id)).toEqual(["ripgrep", "jq", "fd"]);
  });

  it("picks brew on mac for tier-1 tools", () => {
    const plan = buildInstallPlan(["ripgrep"], "mac");
    expect(plan[0].manager).toBe("brew");
    expect(plan[0].command).toBe("brew install ripgrep");
  });

  it("picks apt on linux for tier-1 tools", () => {
    const plan = buildInstallPlan(["ripgrep"], "linux");
    expect(plan[0].manager).toBe("apt");
    expect(plan[0].command).toBe("sudo apt install ripgrep");
  });

  it("picks scoop on win for tier-1 tools", () => {
    const plan = buildInstallPlan(["ripgrep"], "win");
    expect(plan[0].manager).toBe("scoop");
    expect(plan[0].command).toBe("scoop install ripgrep");
  });

  it("populates probe and homepage for each entry", () => {
    const plan = buildInstallPlan(["gh"], "mac");
    expect(plan[0].probe).toBe("gh");
    expect(plan[0].homepage).toBe("https://cli.github.com/");
  });

  it("skips ids that do not exist in the registry", () => {
    const plan = buildInstallPlan(["ripgrep", "definitely-not-a-tool", "jq"], "mac");
    expect(plan.map((p) => p.id)).toEqual(["ripgrep", "jq"]);
  });

  it("returns the same shape across all three OS keys", () => {
    const mac = buildInstallPlan(["jq"], "mac");
    const linux = buildInstallPlan(["jq"], "linux");
    const win = buildInstallPlan(["jq"], "win");
    expect(mac.length).toBe(linux.length);
    expect(linux.length).toBe(win.length);
    for (const plan of [mac, linux, win]) {
      expect(plan[0].id).toBe("jq");
      expect(plan[0].command).toBeDefined();
      expect(plan[0].manager).toBeDefined();
    }
  });
});

describe("offerInstaller", () => {
  let consoleLogSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("returns true and skips the prompt for an empty missing list", async () => {
    const result = await offerInstaller([], { interactive: true });
    expect(result).toBe(true);
    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it("with interactive:false, prints the plan and returns true without prompting", async () => {
    const result = await offerInstaller(["ripgrep", "jq"], {
      interactive: false,
      os: "mac",
    });
    expect(result).toBe(true);
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // It must have printed at least one line — the tool ids and the install
    // commands are the user-visible payload.
    const all = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toContain("ripgrep");
    expect(all).toContain("brew install ripgrep");
    expect(all).toContain("jq");
    expect(all).toContain("brew install jq");
  });

  it("with interactive:true, prompts with the expected message and default=true", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: true });

    const result = await offerInstaller(["ripgrep"], {
      interactive: true,
      os: "linux",
    });

    expect(result).toBe(true);
    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    const call = vi.mocked(inquirer.prompt).mock.calls[0]?.[0] as Array<{
      type: string;
      name: string;
      message: string;
      default: boolean;
    }>;
    expect(call[0].type).toBe("confirm");
    expect(call[0].name).toBe("proceed");
    expect(call[0].message).toContain("install pending");
    expect(call[0].default).toBe(true);
  });

  it("returns the user's confirm answer (false) when they decline", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: false });

    const result = await offerInstaller(["ripgrep"], {
      interactive: true,
      os: "mac",
    });
    expect(result).toBe(false);
  });

  it("prints OS label matching the os option (Windows)", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: true });

    await offerInstaller(["ripgrep"], { interactive: true, os: "win" });

    const all = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toContain("Windows");
    expect(all).toContain("scoop install ripgrep");
  });

  it("defaults interactive to true when omitted", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: true });

    await offerInstaller(["ripgrep"], { os: "mac" });

    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
  });
});
