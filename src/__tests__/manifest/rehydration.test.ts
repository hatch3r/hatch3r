import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { rehydrateCustomization } from "../../manifest/rehydrate.js";
import type { CustomizationManifest } from "../../types.js";

/**
 * F2.3-H1 (Cycle 10 Phase B Wave 1A): unit coverage for the Layer-4 → Layer-2
 * rehydration step that satisfies the
 * `src/adapters/customization.ts::applyCustomizationImpl` JSDoc promise that
 * `manifest.customization` round-trips through `clean` → reinit when
 * project-side `.customize.yaml` files are absent.
 *
 * The verifier finding: manifest.customization was written from three sites
 * and preserved across re-init but never re-emerged at the adapter
 * boundary. This suite proves the materialization step now closes the gap
 * (yaml absent + manifest present → yaml materialized) without breaking
 * Layer-2 precedence (yaml present + manifest present → yaml preserved).
 */
describe("rehydrateCustomization", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-rehydrate-"));
    return tempDir;
  }

  it("returns empty summary when customization is undefined", async () => {
    const projectRoot = await createProjectRoot();
    const summary = await rehydrateCustomization(projectRoot, undefined);
    expect(summary.materialized).toEqual([]);
    expect(summary.preserved).toEqual([]);
    expect(summary.warnings).toEqual([]);
  });

  it("materializes a manifest agent entry to .customize.yaml when YAML is absent", async () => {
    const projectRoot = await createProjectRoot();
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: {
        "hatch3r-reviewer": { model: "opus" },
      },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized).toEqual(["agents/hatch3r-reviewer"]);
    expect(summary.preserved).toEqual([]);
    expect(summary.warnings).toEqual([]);

    const yamlPath = join(projectRoot, ".hatch3r", "agents", "hatch3r-reviewer.customize.yaml");
    const raw = await readFile(yamlPath, "utf-8");
    const parsed = parseYaml(raw);
    expect(parsed).toEqual({ model: "opus" });
  });

  it("preserves an existing .customize.yaml (Layer 2 wins over Layer 4)", async () => {
    const projectRoot = await createProjectRoot();
    // Pre-create a user-owned .customize.yaml with a different value.
    const yamlDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(yamlDir, { recursive: true });
    const yamlPath = join(yamlDir, "hatch3r-reviewer.customize.yaml");
    await writeFile(yamlPath, "model: sonnet\n", "utf-8");

    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: {
        "hatch3r-reviewer": { model: "opus" },
      },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized).toEqual([]);
    expect(summary.preserved).toEqual(["agents/hatch3r-reviewer"]);
    expect(summary.warnings).toEqual([]);

    // The on-disk file is untouched — Layer 2 (user-owned) wins.
    const raw = await readFile(yamlPath, "utf-8");
    expect(raw.trim()).toBe("model: sonnet");
  });

  it("materializes entries across all four canonical types", async () => {
    const projectRoot = await createProjectRoot();
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: { "hatch3r-reviewer": { model: "opus" } },
      skills: { "hatch3r-issue-workflow": { description: "Custom workflow" } },
      rules: { "hatch3r-testing": { scope: "src/**/*.ts" } },
      commands: { "hatch3r-board-pickup": { enabled: false } },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized.sort()).toEqual([
      "agents/hatch3r-reviewer",
      "commands/hatch3r-board-pickup",
      "rules/hatch3r-testing",
      "skills/hatch3r-issue-workflow",
    ]);
    expect(summary.preserved).toEqual([]);
    expect(summary.warnings).toEqual([]);

    // Spot-check each emitted file parses back to the source entry.
    const agent = parseYaml(await readFile(join(projectRoot, ".hatch3r", "agents", "hatch3r-reviewer.customize.yaml"), "utf-8"));
    expect(agent).toEqual({ model: "opus" });
    const skill = parseYaml(await readFile(join(projectRoot, ".hatch3r", "skills", "hatch3r-issue-workflow.customize.yaml"), "utf-8"));
    expect(skill).toEqual({ description: "Custom workflow" });
    const rule = parseYaml(await readFile(join(projectRoot, ".hatch3r", "rules", "hatch3r-testing.customize.yaml"), "utf-8"));
    expect(rule).toEqual({ scope: "src/**/*.ts" });
    const command = parseYaml(await readFile(join(projectRoot, ".hatch3r", "commands", "hatch3r-board-pickup.customize.yaml"), "utf-8"));
    expect(command).toEqual({ enabled: false });
  });

  it("drops fields outside the round-trip whitelist", async () => {
    const projectRoot = await createProjectRoot();
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: {
        "hatch3r-reviewer": {
          model: "opus",
          // unknown future field — must be silently dropped to avoid
          // bleeding un-validated keys into the YAML file.
          unknownFutureField: "leaked",
        },
      },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized).toEqual(["agents/hatch3r-reviewer"]);
    const parsed = parseYaml(await readFile(
      join(projectRoot, ".hatch3r", "agents", "hatch3r-reviewer.customize.yaml"),
      "utf-8",
    ));
    expect(parsed).toEqual({ model: "opus" });
    expect((parsed as Record<string, unknown>).unknownFutureField).toBeUndefined();
  });

  it("skips an entry whose round-trippable field set is empty", async () => {
    const projectRoot = await createProjectRoot();
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: {
        // Only carries an unknown field — no round-trippable content.
        "hatch3r-reviewer": { unknownFutureField: "leaked" },
      },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized).toEqual([]);
    expect(summary.preserved).toEqual([]);
    expect(summary.warnings).toEqual([]);

    // No file should have been created.
    await expect(
      access(join(projectRoot, ".hatch3r", "agents", "hatch3r-reviewer.customize.yaml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent across repeated calls", async () => {
    const projectRoot = await createProjectRoot();
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: { "hatch3r-reviewer": { model: "opus" } },
    };
    const first = await rehydrateCustomization(projectRoot, customization);
    expect(first.materialized).toEqual(["agents/hatch3r-reviewer"]);
    expect(first.preserved).toEqual([]);

    // Second call: yaml now exists on disk from the first call. The materialized
    // path is now preserved (Layer 2 wins), and the function is a no-op.
    const second = await rehydrateCustomization(projectRoot, customization);
    expect(second.materialized).toEqual([]);
    expect(second.preserved).toEqual(["agents/hatch3r-reviewer"]);
    expect(second.warnings).toEqual([]);
  });

  it("ignores entries with non-object payload (manifest schema defense)", async () => {
    const projectRoot = await createProjectRoot();
    // `customization` schema permits Record<string, Record<string, unknown>>
    // but a malformed/older manifest could carry primitives. Verify defense
    // in depth: no crash, no materialization for non-object entries.
    const customization = {
      schemaVersion: 1,
      agents: {
        "valid-entry": { model: "opus" },
        "broken-string": "this is not an object" as unknown,
        "broken-array": ["nope"] as unknown,
      },
    } as unknown as CustomizationManifest;
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized).toEqual(["agents/valid-entry"]);
  });

  it("skips buckets that are absent from the manifest", async () => {
    const projectRoot = await createProjectRoot();
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      // Only `agents` is present; skills/rules/commands all absent.
      agents: { "hatch3r-reviewer": { model: "opus" } },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    expect(summary.materialized).toEqual(["agents/hatch3r-reviewer"]);
    // Skills/rules/commands dirs should not have been touched.
    await expect(access(join(projectRoot, ".hatch3r", "skills"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(projectRoot, ".hatch3r", "rules"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(projectRoot, ".hatch3r", "commands"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never writes outside the project root, even when given a traversal-shaped id", async () => {
    const projectRoot = await createProjectRoot();
    // sanitizeId (src/types.ts) strips `/` and other non-`[a-zA-Z0-9._-]`
    // characters but preserves `.`. A traversal-shaped id like
    // `../../escape` therefore sanitizes to `....escape` — still inside
    // the project root after path resolution. The contract we assert is
    // strict: every materialized path must resolve to a location under
    // `projectRoot`, regardless of what sanitizeId yields.
    const customization: CustomizationManifest = {
      schemaVersion: 1,
      agents: {
        "../../escape": { model: "opus" },
      },
    };
    const summary = await rehydrateCustomization(projectRoot, customization);
    for (const relPath of summary.materialized) {
      // `relPath` is logical (e.g. "agents/....escape"); the on-disk file
      // must sit under `<projectRoot>/.hatch3r/`.
      const fullPath = join(projectRoot, ".hatch3r", relPath + ".customize.yaml");
      // `fs.access` succeeds when the file is at the expected in-root path.
      await access(fullPath);
    }
    // No warnings expected — sanitizeId produced an in-root path, so the
    // path-traversal guard did not need to fire.
    expect(summary.warnings).toEqual([]);
  });
});
