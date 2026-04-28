// D20: tests that `clean` preserves the `.agents/user/` subtree across
// dry-run and live-execution paths. Mirrors the temp-repo + readManifest
// mock pattern in src/__tests__/clean/index.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../manifest/hatchJson.js", async () => {
  const actual = await vi.importActual<typeof import("../../../manifest/hatchJson.js")>(
    "../../../manifest/hatchJson.js",
  );
  return {
    ...actual,
    readManifest: vi.fn(),
  };
});

vi.mock("../../../workspace/detect.js", () => ({
  detectWorkspaceContext: vi.fn().mockResolvedValue({ type: "standalone" }),
}));

import { readManifest } from "../../../manifest/hatchJson.js";
import { detectWorkspaceContext } from "../../../workspace/detect.js";
import { inventoryArtifacts, executeClean } from "../../../clean/index.js";

const AGENTS_DIR = ".agents";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    // ENOENT is the expected sentinel for an absent path; re-throw any
    // other error so a permission or I/O failure surfaces in the test
    // log rather than masquerading as "doesn't exist".
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
}

const VALID_DESC =
  "User-tier clean-test fixture description with enough text to clear the >=60 character description gate";

async function seedRepoWithUserContent(tempDir: string): Promise<void> {
  // Minimal .agents/ canonical layout
  await mkdir(join(tempDir, AGENTS_DIR, "rules"), { recursive: true });
  await mkdir(join(tempDir, AGENTS_DIR, "learnings"), { recursive: true });

  // Adapter output to be removed by clean
  await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
  await writeFile(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"), "cursor");

  // User content
  await mkdir(join(tempDir, AGENTS_DIR, "user", "agents"), { recursive: true });
  await writeFile(
    join(tempDir, AGENTS_DIR, "user", "agents", "my-helper.md"),
    `---\nid: my-helper\ntype: agent\ndescription: ${VALID_DESC}\n---\nbody\n`,
  );
  await mkdir(join(tempDir, AGENTS_DIR, "user", "skills", "my-skill"), {
    recursive: true,
  });
  await writeFile(
    join(tempDir, AGENTS_DIR, "user", "skills", "my-skill", "SKILL.md"),
    `---\nid: my-skill\ntype: skill\ndescription: ${VALID_DESC}\n---\nbody\n`,
  );
}

describe("clean preserves .agents/user/ (D20)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-clean-user-"));
    vi.mocked(readManifest).mockResolvedValue(null);
    vi.mocked(detectWorkspaceContext).mockResolvedValue({ type: "standalone" });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("dry-run lists .agents/user/ in the kept inventory when user content is present", async () => {
    await seedRepoWithUserContent(tempDir);

    const inventory = await inventoryArtifacts(tempDir);
    expect(inventory.userContentCount).toBe(2);

    const result = await executeClean(tempDir, inventory, true);
    const userKept = result.kept.find((k) => k.includes(`${AGENTS_DIR}/user/`));
    expect(userKept).toBeDefined();
    expect(userKept).toMatch(/2 user artifact/);
  });

  it("live clean does not delete .agents/user/ when user content is present", async () => {
    await seedRepoWithUserContent(tempDir);

    const inventory = await inventoryArtifacts(tempDir);
    expect(inventory.userContentCount).toBe(2);

    await executeClean(tempDir, inventory, false);

    // The user subtree must still exist with both artifacts intact.
    expect(await exists(join(tempDir, AGENTS_DIR, "user"))).toBe(true);
    expect(
      await exists(join(tempDir, AGENTS_DIR, "user", "agents", "my-helper.md")),
    ).toBe(true);
    expect(
      await exists(
        join(tempDir, AGENTS_DIR, "user", "skills", "my-skill", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("user content survives a clean+reseed cycle (file content unchanged)", async () => {
    await seedRepoWithUserContent(tempDir);

    const userPath = join(tempDir, AGENTS_DIR, "user", "agents", "my-helper.md");
    const before = await readFile(userPath, "utf-8");

    const inventory = await inventoryArtifacts(tempDir);
    await executeClean(tempDir, inventory, false);

    // No re-init needed for this assertion — the file should be byte-identical.
    const after = await readFile(userPath, "utf-8");
    expect(after).toBe(before);
  });
});
