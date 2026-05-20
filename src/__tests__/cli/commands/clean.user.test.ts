// D20 + Wave 5/6/7: tests that `clean` preserves the user-content subtree
// across dry-run and live-execution paths. Wave 5 relocated user content
// from `.agents/user/` to `.hatch3r/overrides/`; Wave 7 reshaped
// `CleanInventory` to track `hatch3rDir` as a single preserved-state
// bucket. There is no longer a `userContentCount` field — the live
// scan happens elsewhere — but the live `executeClean` still must not
// delete anything under `.hatch3r/overrides/`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HATCH3R_DIR } from "../../../types.js";

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

const OVERRIDES_REL = `${HATCH3R_DIR}/overrides`;

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
  // Adapter output to be removed by clean
  await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
  await writeFile(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"), "cursor");

  // User content under .hatch3r/overrides/ (Wave 5 relocation)
  const overridesDir = join(tempDir, OVERRIDES_REL);
  await mkdir(join(overridesDir, "agents"), { recursive: true });
  await writeFile(
    join(overridesDir, "agents", "my-helper.md"),
    `---\nid: my-helper\ntype: agent\ndescription: ${VALID_DESC}\n---\nbody\n`,
  );
  await mkdir(join(overridesDir, "skills", "my-skill"), { recursive: true });
  await writeFile(
    join(overridesDir, "skills", "my-skill", "SKILL.md"),
    `---\nid: my-skill\ntype: skill\ndescription: ${VALID_DESC}\n---\nbody\n`,
  );
}

describe("clean preserves .hatch3r/overrides/ (D20 + Wave 5)", () => {
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

  it("dry-run lists .hatch3r/ in the kept inventory when overrides are present", async () => {
    await seedRepoWithUserContent(tempDir);

    const inventory = await inventoryArtifacts(tempDir);
    // Wave 7: hatch3rDir tracks the single preserved-state directory.
    expect(inventory.hatch3rDir).toBe(true);

    const result = await executeClean(tempDir, inventory, true);
    // Wave 7 messaging: hatch3rDir is reported as kept with the listed sub-dirs.
    const hatch3rKept = result.kept.find((k) => k.includes(HATCH3R_DIR));
    expect(hatch3rKept).toBeDefined();
    expect(hatch3rKept).toMatch(/overrides/);
  });

  it("live clean does not delete .hatch3r/overrides/ when user content is present", async () => {
    await seedRepoWithUserContent(tempDir);

    const inventory = await inventoryArtifacts(tempDir);
    expect(inventory.hatch3rDir).toBe(true);

    await executeClean(tempDir, inventory, false);

    // The overrides subtree must still exist with both artifacts intact.
    expect(await exists(join(tempDir, OVERRIDES_REL))).toBe(true);
    expect(
      await exists(join(tempDir, OVERRIDES_REL, "agents", "my-helper.md")),
    ).toBe(true);
    expect(
      await exists(
        join(tempDir, OVERRIDES_REL, "skills", "my-skill", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("user content survives a clean cycle (file content unchanged)", async () => {
    await seedRepoWithUserContent(tempDir);

    const userPath = join(tempDir, OVERRIDES_REL, "agents", "my-helper.md");
    const before = await readFile(userPath, "utf-8");

    const inventory = await inventoryArtifacts(tempDir);
    await executeClean(tempDir, inventory, false);

    // The file should be byte-identical after clean.
    const after = await readFile(userPath, "utf-8");
    expect(after).toBe(before);
  });
});
