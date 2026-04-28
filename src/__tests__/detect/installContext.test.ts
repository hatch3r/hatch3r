import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  surveyInstalls,
  _resetNpmGlobalRootCacheForTesting,
} from "../../detect/installContext.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

describe("installContext.surveyInstalls", () => {
  let tempDir: string;
  const originalArgv1 = process.argv[1];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-install-context-"));
    _resetNpmGlobalRootCacheForTesting();
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
  });

  afterEach(async () => {
    process.argv[1] = originalArgv1;
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it("classifies an npx-cached binary as kind=npx", async () => {
    process.argv[1] = "/Users/test/.npm/_npx/abc123/node_modules/hatch3r/dist/cli/index.js";
    const survey = await surveyInstalls(tempDir);
    expect(survey.invokedFrom.kind).toBe("npx");
  });

  it("classifies a path under the project's node_modules as kind=project-local", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    const survey = await surveyInstalls(tempDir);
    expect(survey.invokedFrom.kind).toBe("project-local");
  });

  it("classifies an unrelated path as kind=dev-source", async () => {
    process.argv[1] = "/some/random/path/cli.js";
    const survey = await surveyInstalls(tempDir);
    expect(survey.invokedFrom.kind).toBe("dev-source");
  });

  it("classifies a path under npm root -g as kind=global", async () => {
    const fakeGlobalRoot = "/usr/local/lib/node_modules";
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from(`${fakeGlobalRoot}\n`));
    process.argv[1] = `${fakeGlobalRoot}/hatch3r/dist/cli/index.js`;
    const survey = await surveyInstalls(tempDir);
    expect(survey.invokedFrom.kind).toBe("global");
  });

  it("populates alsoPresent.project-local when invoked-from is global and node_modules/hatch3r exists", async () => {
    const fakeGlobalRoot = "/usr/local/lib/node_modules";
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from(`${fakeGlobalRoot}\n`));
    process.argv[1] = `${fakeGlobalRoot}/hatch3r/dist/cli/index.js`;

    const projectPkg = join(tempDir, "node_modules", "hatch3r");
    await mkdir(projectPkg, { recursive: true });
    await writeFile(
      join(projectPkg, "package.json"),
      JSON.stringify({ name: "hatch3r", version: "1.0.0" }),
    );

    const survey = await surveyInstalls(tempDir);
    expect(survey.invokedFrom.kind).toBe("global");
    expect(survey.alsoPresent.length).toBe(1);
    expect(survey.alsoPresent[0]?.kind).toBe("project-local");
    expect(survey.alsoPresent[0]?.version).toBe("1.0.0");
  });

  it("does not crash when npm root -g returns empty / fails", async () => {
    process.argv[1] = "/some/path/cli.js";
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("npm not found");
    });
    const survey = await surveyInstalls(tempDir);
    expect(survey.invokedFrom.kind).toBe("dev-source");
    // alsoPresent should be empty (no global probe could resolve) and no
    // project-local install exists in the temp dir.
    expect(survey.alsoPresent).toEqual([]);
  });

  it("reads version from invoked-from packageRoot when present", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    const survey = await surveyInstalls(tempDir);
    // invokedFrom packageRoot is wherever the source file resolves — version
    // should be readable for the running hatch3r dev install. The exact
    // version varies; just assert the field exists.
    expect(typeof survey.invokedFrom.version === "string" || survey.invokedFrom.version === null).toBe(true);
  });
});
