import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HatchManifest } from "../../types.js";

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
import { findMissingCliTools } from "../../cliTools/detect.js";
import {
  offerInstaller,
  printMissingCliToolsDisclaimer,
} from "../../cliTools/install.js";
import { cliToolsCommand, cliToolsInstallCommand } from "../../cli/commands/cliTools.js";

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
