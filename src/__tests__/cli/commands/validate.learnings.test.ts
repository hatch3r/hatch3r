// F6.4-C1: `hatch3r validate` must scan the USER repo's `.hatch3r/learnings/`
// (and `.hatch3r/handoffs/`) for poison content, NOT the bundled canonical
// content tree. Prior to the fix `validateContentConsistency` joined
// `agentsDir` (= bundled canonical root) with `"learnings"`, which resolved
// to `<npm-package-root>/learnings/`. Canonical ships zero learnings, so
// `validateLearningsDirectory` short-circuited via ENOENT and any poisoned
// user-tier learning file passed validation silently.
//
// These tests plant a poison file in `<rootDir>/.hatch3r/learnings/` and
// assert that the public `validateCommand` flow surfaces the resulting
// error. Pattern mirrors `validate.user.test.ts` (createMinimalAgentsDir +
// cwd spy + exit spy + console capture).
//
// Source ref: src/cli/commands/validate.ts:770,:784
// Bug detail: bug fixed by replacing `agentsDir` with `rootDir + HATCH3R_DIR`
// in the learnings + handoffs join.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../../types.js";

const HATCH3R_DIR = ".hatch3r";

async function createMinimalManifest(root: string): Promise<void> {
  const hatch3rDir = join(root, HATCH3R_DIR);
  await mkdir(hatch3rDir, { recursive: true });
  const manifest = {
    version: "1.0.0",
    schemaVersion: 3,
    hatch3rVersion: "1.0.0",
    owner: "test-org",
    repo: "test-repo",
    tools: ["cursor"],
    features: {
      agents: true,
      skills: true,
      rules: true,
      prompts: true,
      commands: true,
      mcp: true,
      githubAgents: true,
      hooks: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
  };
  await writeFile(
    join(hatch3rDir, "hatch.json"),
    JSON.stringify(manifest, null, 2),
  );
}

async function plantLearning(
  rootDir: string,
  fileName: string,
  content: string,
): Promise<void> {
  const dir = join(rootDir, HATCH3R_DIR, "learnings");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), content);
}

describe("validate command — user learnings directory (F6.4-C1)", () => {
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function combinedOutput(): string {
    return [
      ...consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])),
    ].join(" ");
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-validate-learnings-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("surfaces an error when an empty learning file is planted in .hatch3r/learnings/", async () => {
    // Empty content is a deterministic error path from
    // `validateLearningContent` -> "Learning ... is empty". Picked over
    // injection patterns because the empty-content check returns an error
    // (not a warning), which is the precise contract the F6.4-C1 fix
    // restores: a poisoned user learning surfaces as an ERROR via
    // validate's exit-code path.
    await createMinimalManifest(tempDir);
    await plantLearning(tempDir, "poison.md", "   \n  \n   ");

    const { validateCommand } = await import("../../../cli/commands/validate.js");
    await expect(validateCommand()).rejects.toThrow(HatchError);

    const out = combinedOutput();
    expect(out).toContain("poison.md");
    expect(out).toMatch(/empty/i);
  });

  it("surfaces an error when a learning file has a binary (null-byte) payload", async () => {
    // Second poison vector: binary content. Confirms the directory under
    // scan is the user repo's `.hatch3r/learnings/` (the fix's intent),
    // not the bundled canonical learnings/ which ships none of these.
    await createMinimalManifest(tempDir);
    await plantLearning(tempDir, "binary-poison.md", "text\0with null bytes\0");

    const { validateCommand } = await import("../../../cli/commands/validate.js");
    await expect(validateCommand()).rejects.toThrow(HatchError);

    const out = combinedOutput();
    expect(out).toContain("binary-poison.md");
    expect(out).toMatch(/binary content/i);
  });

  it("passes validation when no learnings directory is present (ENOENT short-circuit)", async () => {
    // Counter-test: when the user repo has no `.hatch3r/learnings/` at all,
    // `validateLearningsDirectory` must return `valid` (ENOENT short-circuit)
    // and the validate command must not throw on that channel alone. The
    // pre-fix behavior also passed here, but only by coincidence (it was
    // scanning the non-existent bundled `learnings/`). This test pins the
    // post-fix contract: user repos without learnings remain quiet.
    await createMinimalManifest(tempDir);

    const { validateCommand } = await import("../../../cli/commands/validate.js");
    await validateCommand();

    const out = combinedOutput();
    // No learnings-related error or warning should fire when the directory
    // does not exist in the user repo.
    expect(out).not.toMatch(/Learning ".*" is empty/);
    expect(out).not.toMatch(/Learning ".*" contains binary content/);
  });
});
