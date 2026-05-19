import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectProjectType } from "../../detect/projectType.js";
import type { RepoInfo } from "../../types.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn() };
});

import { execSync } from "node:child_process";

function makeInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    languages: ["unknown"],
    packageManager: "unknown",
    frameworks: [],
    isMonorepo: false,
    hasExistingAgents: false,
    existingTools: [],
    rootDir: "/tmp",
    ...overrides,
  };
}

describe("detectProjectType", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-projecttype-"));
    vi.mocked(execSync).mockImplementation((() => {
      throw new Error("no git");
    }) as never);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns greenfield with empty signals for a fresh empty repo", async () => {
    const info = makeInfo();
    const det = await detectProjectType(info, tempDir);
    expect(det.type).toBe("greenfield");
    expect(det.confidence).toBeLessThan(0.40);
    expect(det.signals).toEqual([]);
  });

  it("returns brownfield with high confidence for strong brownfield signals", async () => {
    vi.mocked(execSync).mockReturnValue("42\n" as never);
    await mkdir(join(tempDir, "src"));
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { a: "1", b: "1", c: "1" },
        devDependencies: { d: "1", e: "1" },
      }),
    );
    const info = makeInfo({ languages: ["typescript"] });
    const det = await detectProjectType(info, tempDir);
    expect(det.type).toBe("brownfield");
    expect(det.confidence).toBeGreaterThanOrEqual(0.95);
    expect(det.signals.length).toBe(3);
    expect(det.signals[0]).toBe("42 commits");
  });

  it("flips to brownfield exactly at the 0.40 threshold", async () => {
    const info = makeInfo({ hasExistingAgents: true });
    const det = await detectProjectType(info, tempDir);
    expect(det.type).toBe("greenfield");
    expect(det.confidence).toBeCloseTo(0.30, 5);

    await mkdir(join(tempDir, "src"));
    const det2 = await detectProjectType(info, tempDir);
    expect(det2.type).toBe("brownfield");
    expect(det2.confidence).toBeCloseTo(0.50, 5);
  });

  it("treats hasExistingAgents plus one weak signal as brownfield", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { a: "1" } }),
    );
    const info = makeInfo({ hasExistingAgents: true });
    const det = await detectProjectType(info, tempDir);
    expect(det.type).toBe("brownfield");
    expect(det.signals).toContain("existing .agents/");
    expect(det.signals).toContain("1 deps");
  });

  it("orders signals top-3 by weight", async () => {
    vi.mocked(execSync).mockReturnValue("100\n" as never);
    await mkdir(join(tempDir, "src"));
    await mkdir(join(tempDir, "lib"));
    const info = makeInfo({
      hasExistingAgents: true,
      languages: ["python"],
      existingTools: ["cursor"],
    });
    const det = await detectProjectType(info, tempDir);
    expect(det.signals.length).toBe(3);
    expect(det.signals[0]).toBe("100 commits");
    expect(det.signals[1]).toBe("existing .agents/");
    expect(det.signals[2]).toBe("lang: python");
    expect(det.confidence).toBe(1);
  });

  it("never throws when filesystem checks fail", async () => {
    const info = makeInfo({ languages: ["go"] });
    const det = await detectProjectType(info, "/nonexistent/path/that/does/not/exist");
    expect(det.type).toBeDefined();
    expect(det.signals).toContain("lang: go");
  });
});
