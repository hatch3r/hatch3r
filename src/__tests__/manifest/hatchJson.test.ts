import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createManifest,
  addManagedFile,
  removeManagedFile,
  migrateManifest,
  readManifest,
  writeManifest,
  extractPreservedManifestFields,
  applyPreservedManifestFields,
  readCliToolsConfig,
  readMaturityTier,
  readConfidenceFloor,
  isValidGitBranchName,
} from "../../manifest/hatchJson.js";
import {
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_MATURITY_TIER,
  HatchError,
  type BoardConfig,
  type ConfidenceFloor,
  type HatchManifest,
  type MaturityTier,
} from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";

describe("hatchJson", () => {
  describe("createManifest", () => {
    it("creates manifest with defaults", () => {
      const manifest = createManifest({
        tools: ["cursor"],
      });
      // Wave 6 (1.9.0 / schemaVersion 3): manifest path and shape bumped.
      expect(manifest.version).toBe("3.0.0");
      expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
      expect(manifest.platform).toBe("github");
      expect(manifest.tools).toEqual(["cursor"]);
      expect(manifest.features.agents).toBe(true);
      expect(manifest.features.skills).toBe(true);
      expect(manifest.features.rules).toBe(true);
      // Cycle 11 D2-3: prompts defaults OFF (no adapter emits prompt files;
      // canonical ships no `prompts/` content) to stop a spurious happy-path
      // unsupported-feature warning.
      expect(manifest.features.prompts).toBe(false);
      expect(manifest.features.commands).toBe(true);
      // W3-mcp-optin: MCP defaults OFF — pure opt-in via `init --mcp` or the
      // `hatch3r mcp setup` side-door; init derives the effective flag from
      // the resolved server list.
      expect(manifest.features.mcp).toBe(false);
      expect(manifest.features.githubAgents).toBe(true);
      expect(manifest.managedFiles).toEqual([]);
    });

    it("accepts custom features as partial overrides", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        features: { agents: false },
      });
      expect(manifest.features.agents).toBe(false);
      expect(manifest.features.rules).toBe(true);
      expect(manifest.features.skills).toBe(true);
    });

    it("accepts multiple disabled features", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        features: { agents: false, skills: false, mcp: false },
      });
      expect(manifest.features.agents).toBe(false);
      expect(manifest.features.skills).toBe(false);
      expect(manifest.features.mcp).toBe(false);
      expect(manifest.features.rules).toBe(true);
    });

    it("accepts MCP servers", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        mcpServers: ["github", "context7"],
      });
      expect(manifest.mcp.servers).toEqual(["github", "context7"]);
    });

    it("derives features.mcp=true from a non-empty server list when features is not provided", () => {
      // W3-mcp-optin hardening: a manifest must never carry `mcp.servers`
      // entries while reporting the feature off.
      const manifest = createManifest({
        tools: ["cursor"],
        mcpServers: ["github", "context7"],
      });
      expect(manifest.features.mcp).toBe(true);
    });

    it("explicit features.mcp=false wins over a non-empty server list", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        features: { mcp: false },
        mcpServers: ["github"],
      });
      expect(manifest.features.mcp).toBe(false);
    });

    it("defaults MCP servers to empty array", () => {
      const manifest = createManifest({
        tools: ["cursor"],
      });
      expect(manifest.mcp.servers).toEqual([]);
    });

    it("accepts multiple tools", () => {
      const manifest = createManifest({
        tools: ["cursor", "copilot", "claude"],
      });
      expect(manifest.tools).toEqual(["cursor", "copilot", "claude"]);
    });

    it("sets platform to github by default", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      expect(manifest.platform).toBe("github");
    });

    it("accepts azure-devops platform", () => {
      const manifest = createManifest({
        platform: "azure-devops",
        owner: "my-org",
        repo: "my-repo",
        namespace: "my-org",
        project: "my-project",
        tools: ["cursor"],
      });
      expect(manifest.platform).toBe("azure-devops");
      expect(manifest.namespace).toBe("my-org");
      expect(manifest.project).toBe("my-project");
    });

    it("accepts gitlab platform", () => {
      const manifest = createManifest({
        platform: "gitlab",
        owner: "my-group",
        repo: "my-project",
        tools: ["cursor"],
      });
      expect(manifest.platform).toBe("gitlab");
      expect(manifest.namespace).toBe("my-group");
      expect(manifest.project).toBe("my-project");
    });

    it("derives namespace from owner and project from repo when not specified", () => {
      const manifest = createManifest({
        owner: "acme",
        repo: "webapp",
        tools: ["cursor"],
      });
      expect(manifest.namespace).toBe("acme");
      expect(manifest.project).toBe("webapp");
    });

    // D14-13 (D14-SA14.4-F3): convention conflicts persist on the manifest so
    // status/verify can re-surface the single-toolchain-guidance warning.
    it("persists detected convention conflicts", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        conflicts: [
          {
            dimension: "testFramework",
            tools: ["jest", "vitest"],
            message: "Detected 2 competing test frameworks (jest, vitest); pick one.",
          },
        ],
      });
      expect(manifest.conflicts).toHaveLength(1);
      expect(manifest.conflicts![0]!.dimension).toBe("testFramework");
      expect(manifest.conflicts![0]!.tools).toEqual(["jest", "vitest"]);
    });

    it("omits the conflicts field when none are detected", () => {
      expect(createManifest({ tools: ["cursor"] }).conflicts).toBeUndefined();
      expect(createManifest({ tools: ["cursor"], conflicts: [] }).conflicts).toBeUndefined();
    });

    it("persists a non-npm package manager (D14-M7)", () => {
      const manifest = createManifest({ tools: ["cursor"], packageManager: "pnpm" });
      expect(manifest.packageManager).toBe("pnpm");
    });

    it("omits packageManager when 'unknown' or absent (byte-identity for npm projects)", () => {
      expect(createManifest({ tools: ["cursor"] }).packageManager).toBeUndefined();
      expect(
        createManifest({ tools: ["cursor"], packageManager: "unknown" }).packageManager,
      ).toBeUndefined();
    });
  });

  describe("migrateManifest", () => {
    it("leaves platform undefined when missing so migration checkpoint can prompt", () => {
      const result = migrateManifest({
        version: "1.0.0",
        hatch3rVersion: "0.9.0",
        owner: "acme",
        repo: "app",
        tools: ["cursor"],
        features: {},
        mcp: { servers: [] },
        managedFiles: [],
      });
      expect(result.platform).toBeUndefined();
    });

    it("derives namespace from owner when missing", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
      });
      expect(result.namespace).toBe("acme");
    });

    it("derives project from repo when missing", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
      });
      expect(result.project).toBe("app");
    });

    it("bumps version from 1.0.0 to 3.0.0 (chained 1->2->3 migration)", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
      });
      // Wave 6 (1.9.0 / schemaVersion 3): migration chain runs
      // 1.0.0 -> 2.0.0 -> 3.0.0 in a single pass.
      expect(result.version).toBe("3.0.0");
    });

    it("does not overwrite existing platform", () => {
      const result = migrateManifest({
        version: "2.0.0",
        platform: "gitlab",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
      });
      expect(result.platform).toBe("gitlab");
    });

    it("does not overwrite existing namespace", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
        namespace: "custom-ns",
      });
      expect(result.namespace).toBe("custom-ns");
    });

    it("does not overwrite existing project", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
        project: "custom-proj",
      });
      expect(result.project).toBe("custom-proj");
    });

    it("bumps version from 2.0.0 to 3.0.0", () => {
      const result = migrateManifest({
        version: "2.0.0",
        platform: "github",
        owner: "acme",
        repo: "app",
      });
      // Wave 6 (1.9.0 / schemaVersion 3): 2.0.0 -> 3.0.0 on read.
      expect(result.version).toBe("3.0.0");
    });

    it("handles empty manifest gracefully", () => {
      const result = migrateManifest({});
      expect(result.platform).toBeUndefined();
      expect(result.namespace).toBe("");
      expect(result.project).toBe("");
    });
  });

  describe("addManagedFile", () => {
    it("adds file to managed list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, ".cursor/rules/test.mdc");
      expect(manifest.managedFiles).toContain(".cursor/rules/test.mdc");
    });

    it("does not duplicate entries", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "test.md");
      addManagedFile(manifest, "test.md");
      expect(manifest.managedFiles.filter((f) => f === "test.md")).toHaveLength(1);
    });

    it("can add multiple different files", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "file1.md");
      addManagedFile(manifest, "file2.md");
      addManagedFile(manifest, "file3.md");
      expect(manifest.managedFiles).toHaveLength(3);
      expect(manifest.managedFiles).toEqual(["file1.md", "file2.md", "file3.md"]);
    });

    it("mutates manifest in place", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      const ref = manifest.managedFiles;
      addManagedFile(manifest, "new-file.md");
      expect(ref).toContain("new-file.md");
    });
  });

  describe("removeManagedFile", () => {
    it("removes a file from managed list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "file1.md");
      addManagedFile(manifest, "file2.md");
      removeManagedFile(manifest, "file1.md");
      expect(manifest.managedFiles).toEqual(["file2.md"]);
    });

    it("is a no-op when file is not in list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "file1.md");
      removeManagedFile(manifest, "nonexistent.md");
      expect(manifest.managedFiles).toEqual(["file1.md"]);
    });

    it("handles empty managed files list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      removeManagedFile(manifest, "file.md");
      expect(manifest.managedFiles).toEqual([]);
    });
  });

  describe("readManifest", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-manifest-"));
      // Wave 6: manifest lives at `.hatch3r/hatch.json` now.
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });
      return tempDir;
    }

    async function writeManifestJson(rootDir: string, data: unknown): Promise<void> {
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    }

    it("returns null when manifest file does not exist", async () => {
      const rootDir = await setup();
      const result = await readManifest(rootDir);
      expect(result).toBeNull();
    });

    it("throws on malformed JSON", async () => {
      const rootDir = await setup();
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        "{ not valid json }}}",
        "utf-8",
      );
      await expect(readManifest(rootDir)).rejects.toThrow("Malformed JSON");
    });

    // C7-H14: readManifest throws HatchError (not plain Error) so the CLI can
    // distinguish CONFIG_ERROR (malformed JSON / invalid manifest) from other
    // failure modes and surface a structured exitCode.
    it("throws HatchError with CONFIG_ERROR code on malformed JSON", async () => {
      const rootDir = await setup();
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        "{ not valid json }}}",
        "utf-8",
      );
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        // D8-SA8.1-01: CONFIG_ERROR resolves through ERROR_CODE_TO_EXIT_CODE to
        // sysexits.h EX_DATAERR (65); readManifest no longer hand-picks `1`,
        // matching the writeManifest assertion below and the SSOT in types.ts.
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    // D10-SA10.2-F2: a malformed-JSON manifest is one of the highest-traffic
    // failure surfaces (hand edits, partial writes). readManifest attaches an
    // actionable recoveryHint pointing at the fix path (init / git restore).
    it("attaches an actionable recoveryHint on malformed JSON", async () => {
      const rootDir = await setup();
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        "{ not valid json }}}",
        "utf-8",
      );
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        const hint = (e as HatchError).recoveryHint;
        expect(hint).toContain("hatch3r init");
        expect(hint).toContain("git checkout");
        expect(hint).toContain(".hatch3r/hatch.json");
      }
    });

    // D10-SA10.2-F2: a structurally-invalid manifest (missing/typed fields)
    // carries a recoveryHint steering the operator to `hatch3r init`.
    it("attaches an actionable recoveryHint on an invalid manifest", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, { invalid: true });
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).recoveryHint).toContain("hatch3r init");
      }
    });

    it("throws with descriptive message when required field 'tools' is missing", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        // tools: missing
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("throws with descriptive message when required field 'version' is missing", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        // version: missing
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("throws when tools is a string instead of an array", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: "cursor",
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("throws when managedFiles is missing", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        // managedFiles: missing
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("throws when features is null instead of an object", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: null,
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("preserves extra unexpected fields in the manifest", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        customField: "should be preserved",
        extraNumber: 42,
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      // Extra fields should pass through validation and be preserved on the returned object
      const raw = result as unknown as Record<string, unknown>;
      expect(raw.customField).toBe("should be preserved");
      expect(raw.extraNumber).toBe(42);
    });

    it("reads a valid manifest successfully", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      // Wave 6: 2.0.0 manifests are migrated to 3.0.0 on read.
      expect(result!.version).toBe("3.0.0");
      expect(result!.tools).toEqual(["cursor"]);
    });

    it("migrates v1.0.0 manifest and validates successfully", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "1.0.0",
        hatch3rVersion: "0.9.0",
        owner: "acme",
        repo: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      // Wave 6: chained migration runs 1.0.0 -> 2.0.0 -> 3.0.0.
      expect(result!.version).toBe("3.0.0");
      expect(result!.namespace).toBe("acme");
      expect(result!.project).toBe("app");
    });

    it("throws descriptive error suggesting hatch3r init to regenerate", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, { invalid: true });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Run hatch3r init to regenerate/,
      );
    });

    it("validates content sub-schema: rejects non-string preset", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: 123,
          projectType: "brownfield",
          teamSize: "solo",
          items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("validates content sub-schema: rejects missing items", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: "standard",
          projectType: "brownfield",
          teamSize: "solo",
          // items is missing
        },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("accepts valid content sub-schema", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: "standard",
          projectType: "brownfield",
          teamSize: "solo",
          items: { agents: ["hatch3r-researcher"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        },
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.content?.preset).toBe("standard");
      expect(result!.content?.items.agents).toContain("hatch3r-researcher");
    });

    // F1.2-H2 (Cycle 10 D1): a hand-edited manifest with an out-of-enum
    // `maturity` (e.g. the typo "enterprice") must be rejected at the
    // persistence boundary with HatchError(CONFIG_ERROR) instead of silently
    // falling back to the "solo" content surface.
    it("rejects an invalid maturity tier (typo) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        maturity: "enterprice",
      });
      try {
        await readManifest(rootDir);
        throw new Error("expected readManifest to throw on invalid maturity");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as Error).message).toMatch(/Invalid manifest/);
      }
    });

    it("rejects a non-string maturity value", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        maturity: 3,
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest/,
      );
    });

    it("rejects an out-of-enum packageManager value (D14-M7) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        packageManager: "deno",
      });
      try {
        await readManifest(rootDir);
        throw new Error("expected readManifest to throw on invalid packageManager");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as Error).message).toMatch(/packageManager/);
      }
    });

    it("round-trips a persisted packageManager through write + read (D14-M7)", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        languages: ["typescript"],
        packageManager: "pnpm",
      });
      const manifest = await readManifest(rootDir);
      expect(manifest?.packageManager).toBe("pnpm");
    });

    it("accepts a valid maturity tier", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        maturity: "enterprise",
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.maturity).toBe("enterprise");
    });

    it("accepts a manifest with no maturity field (pre-2.0 shape)", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.maturity).toBeUndefined();
    });

    // D13-SA13.3-F13.3.3 (Cycle 10 Wave 4): a hand-edited manifest with an
    // out-of-enum `confidenceFloor` must be rejected at the persistence boundary
    // with HatchError(CONFIG_ERROR) rather than silently mis-driving the
    // orchestrator assertiveness gate. Mirrors the `maturity` guard above.
    it("rejects an invalid confidenceFloor value with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        confidenceFloor: "paranoid",
      });
      try {
        await readManifest(rootDir);
        throw new Error("expected readManifest to throw on invalid confidenceFloor");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as Error).message).toMatch(/Invalid manifest/);
      }
    });

    it("accepts a valid confidenceFloor and a manifest with no confidenceFloor field", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        confidenceFloor: "high",
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.confidenceFloor).toBe("high");
    });
  });

  // Wave 6 (1.9.0): one-shot relocation of `.agents/hatch.json` ->
  // `.hatch3r/hatch.json` triggered the first time `readManifest` runs
  // against a pre-1.9 install. The shim must be idempotent and emit a
  // single console warning so operators see why the directory changed.
  describe("readManifest migration shim (.agents/ -> .hatch3r/)", () => {
    let tempDir: string;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(async () => {
      warnSpy.mockRestore();
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it("relocates a pre-1.9 .agents/hatch.json to .hatch3r/hatch.json on read", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-shim-"));
      // Seed a pre-1.9 install with the legacy `.agents/` location.
      // Inline literal — this is one of the only legitimate uses of `.agents`
      // in the rewritten test surface (migration-shim test setup).
      const legacyDir = join(tempDir, ".agents");
      await mkdir(legacyDir, { recursive: true });
      const legacyManifest = {
        version: "2.0.0",
        hatch3rVersion: "1.8.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true, handoffs: true },
        mcp: { servers: [] },
        managedFiles: [],
      };
      await writeFile(join(legacyDir, "hatch.json"), JSON.stringify(legacyManifest, null, 2), "utf-8");

      const result = await readManifest(tempDir);
      expect(result).not.toBeNull();
      expect(result!.tools).toEqual(["cursor"]);

      // Manifest now lives under .hatch3r/.
      await expect(access(join(tempDir, ".hatch3r", "hatch.json"))).resolves.toBeUndefined();
      // Legacy path is gone.
      await expect(access(join(tempDir, ".agents", "hatch.json"))).rejects.toThrow();

      // A single one-shot warning was emitted.
      const warnCalls = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      const matchingWarn = warnCalls.find((m: string) => /Migrated manifest from .agents/.test(m));
      expect(matchingWarn).toBeDefined();
    });

    it("is a no-op when .hatch3r/hatch.json already exists (legacy ignored)", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-shim-"));
      // Pre-existing new layout
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });
      const newManifest = {
        version: "3.0.0",
        hatch3rVersion: "1.9.0",
        owner: "current",
        repo: "current",
        namespace: "current",
        project: "current",
        tools: ["claude"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true, handoffs: true },
        mcp: { servers: [] },
        managedFiles: [],
      };
      await writeFile(join(tempDir, ".hatch3r", "hatch.json"), JSON.stringify(newManifest, null, 2), "utf-8");

      // Also seed a stale legacy manifest — shim must NOT touch it.
      await mkdir(join(tempDir, ".agents"), { recursive: true });
      await writeFile(
        join(tempDir, ".agents", "hatch.json"),
        JSON.stringify({ ...newManifest, owner: "stale" }, null, 2),
        "utf-8",
      );

      const result = await readManifest(tempDir);
      expect(result).not.toBeNull();
      // We read from the new path, not the legacy stale one.
      expect(result!.owner).toBe("current");

      // No migration warning was emitted because no migration happened.
      const warnCalls = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      const matchingWarn = warnCalls.find((m: string) => /Migrated manifest from .agents/.test(m));
      expect(matchingWarn).toBeUndefined();

      // Legacy file untouched.
      await expect(access(join(tempDir, ".agents", "hatch.json"))).resolves.toBeUndefined();
    });
  });

  describe("writeManifest", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("writes a manifest that can be read back", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"], mcpServers: ["github"] });
      await writeManifest(tempDir, manifest);

      const result = await readManifest(tempDir);
      expect(result).not.toBeNull();
      expect(result!.tools).toEqual(["cursor"]);
      expect(result!.mcp.servers).toEqual(["github"]);
    });

    it("writes valid JSON with trailing newline", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"] });
      await writeManifest(tempDir, manifest);

      const raw = await readFile(join(tempDir, ".hatch3r", "hatch.json"), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("overwrites existing manifest", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const original = createManifest({ tools: ["cursor"] });
      await writeManifest(tempDir, original);

      const updated = createManifest({ tools: ["claude", "cursor"] });
      await writeManifest(tempDir, updated);

      const result = await readManifest(tempDir);
      expect(result!.tools).toEqual(["claude", "cursor"]);
    });

    // C8-D1-M2: writeManifest must validate the manifest schema before
    // persisting to disk to prevent corrupt state from being serialized.
    it("throws HatchError(CONFIG_ERROR) when managedFiles is not an array", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"] });
      // Force an invalid shape past TS via cast.
      (manifest as unknown as Record<string, unknown>).managedFiles = "not-an-array";

      try {
        await writeManifest(tempDir, manifest);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        // SA12.1-F-D12-M1: CONFIG_ERROR defaults to sysexits.h EX_DATAERR (65).
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    it("throws when tools contains invalid tool name outside VALID_TOOLS", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"] });
      (manifest as unknown as Record<string, unknown>).tools = ["not-a-real-tool"];

      await expect(writeManifest(tempDir, manifest)).rejects.toThrow(
        /Invalid manifest schema/,
      );
    });

    it("throws when required field (mcp) is missing", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"] });
      // Remove mcp entirely.
      delete (manifest as unknown as Record<string, unknown>).mcp;

      await expect(writeManifest(tempDir, manifest)).rejects.toThrow(HatchError);
    });

    it("does NOT write file when validation fails", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"] });
      (manifest as unknown as Record<string, unknown>).managedFiles = null;

      await expect(writeManifest(tempDir, manifest)).rejects.toThrow(HatchError);

      // Confirm no file was written — access must reject with ENOENT.
      const manifestPath = join(tempDir, ".hatch3r", "hatch.json");
      try {
        await access(manifestPath);
        throw new Error("manifest file should not exist after failed validation");
      } catch (e) {
        expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });

    it("round-trip: createManifest then write then read succeeds", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });

      const manifest = createManifest({
        tools: ["cursor", "claude"],
        mcpServers: ["github"],
        owner: "acme",
        repo: "app",
      });
      await writeManifest(tempDir, manifest);

      const result = await readManifest(tempDir);
      expect(result).not.toBeNull();
      expect(result!.tools).toEqual(["cursor", "claude"]);
      expect(result!.mcp.servers).toEqual(["github"]);
      expect(result!.owner).toBe("acme");
      expect(result!.repo).toBe("app");
    });
  });

  describe("manifest validation (#108)", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-validate-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });
      return tempDir;
    }

    async function writeManifestJson(rootDir: string, data: unknown): Promise<void> {
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    }

    it("rejects invalid tool names in tools array", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["invalid-tool"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("rejects non-string tool entries", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: [123, "cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("accepts all known tool names", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor", "claude", "copilot"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.tools).toEqual(["cursor", "claude", "copilot"]);
    });

    it("validates board sub-schema", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        board: { owner: 123 },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("validates worktree.extraPatterns must be string array", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        worktree: { enabled: true, extraPatterns: [123] },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("accepts valid worktree.extraPatterns", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        worktree: { enabled: true, extraPatterns: [".custom-dir/"] },
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.worktree?.extraPatterns).toEqual([".custom-dir/"]);
    });

    // D3-15 (Cycle 11 Wave 3, D1, Medium): the `board.defaultBranch` guard at
    // hatchJson.ts (isValidGitBranchName) was only exercised through the unit
    // `isValidGitBranchName` tests; the board negative manifest test only fed
    // `board.owner:123`, so the guard's integration through readManifest was
    // unexercised and a validator refactor could drop it silently. These pin
    // the readManifest -> HatchError(CONFIG_ERROR) path for an invalid branch.
    it("rejects an invalid board.defaultBranch (`foo..bar`) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        board: { owner: "a", repo: "b", defaultBranch: "foo..bar" },
      });
      try {
        await readManifest(rootDir);
        throw new Error("expected readManifest to throw on invalid board.defaultBranch");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as Error).message).toMatch(/board\.defaultBranch/);
      }
    });

    it.each(["@", "x.lock", "/x", "x/"])(
      "rejects board.defaultBranch %j as an invalid git branch name with CONFIG_ERROR",
      async (badBranch) => {
        const rootDir = await setup();
        await writeManifestJson(rootDir, {
          version: "3.0.0",
          hatch3rVersion: "2.0.0",
          owner: "acme",
          repo: "app",
          namespace: "acme",
          project: "app",
          tools: ["cursor"],
          features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
          mcp: { servers: [] },
          managedFiles: [],
          board: { owner: "a", repo: "b", defaultBranch: badBranch },
        });
        try {
          await readManifest(rootDir);
          throw new Error(`expected readManifest to throw on board.defaultBranch=${badBranch}`);
        } catch (e) {
          expect(e).toBeInstanceOf(HatchError);
          expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
          expect((e as Error).message).toMatch(/board\.defaultBranch/);
        }
      },
    );

    it("accepts a valid board.defaultBranch through readManifest", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        board: { owner: "a", repo: "b", defaultBranch: "feature/x" },
      });
      const result = await readManifest(rootDir);
      expect(result?.board?.defaultBranch).toBe("feature/x");
    });

    // D1-23 (Cycle 11 Wave 3, D1, Medium): collectManifestErrors previously
    // skipped 8 optional fields (models/cliTools/claude/repos/packages/hooks/
    // languages/versionConstraint), so a hand-edited `models.agents.<id>=42`
    // reached resolveAgentModel and stamped a non-string model into adapter
    // output. These pin the persistence-boundary rejection per field.
    it("rejects a non-string models.agents.<id> (42) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        models: { agents: { "hatch3r-researcher": 42 } },
      });
      try {
        await readManifest(rootDir);
        throw new Error("expected readManifest to throw on non-string models.agents entry");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as Error).message).toMatch(/models\.agents\.hatch3r-researcher/);
      }
    });

    it("rejects a non-string models.default with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        models: { default: 7 },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/models\.default/);
    });

    // release/2.2.0: the per-artifact model maps extend to skills and commands;
    // both get the same persistence-boundary string-map checks as models.agents
    // so a malformed value fails closed before reaching resolveArtifactModel.
    it("rejects a non-string models.skills.<id> (42) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        models: { skills: { "hatch3r-feature": 42 } },
      });
      try {
        await readManifest(rootDir);
        throw new Error("expected readManifest to throw on non-string models.skills entry");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as Error).message).toMatch(/models\.skills\.hatch3r-feature/);
      }
    });

    it("rejects an array-valued models.commands with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        models: { commands: ["opus"] },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/models\.commands/);
    });

    it("rejects an unknown claude.teammateMode with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        claude: { teammateMode: "bogus-mode" },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/claude\.teammateMode/);
    });

    it("rejects non-string claude.permissions.allow entries with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        claude: { permissions: { allow: ["Read", 1] } },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/claude\.permissions\.allow/);
    });

    it("rejects a non-boolean hooks.enabled with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        hooks: { enabled: "yes" },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/hooks\.enabled/);
    });

    it("rejects a non-string languages entry with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        languages: ["typescript", 99],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/languages/);
    });

    it("rejects a malformed repos entry (missing repo) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        repos: [{ owner: "acme" }],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/repos\[0\]\.repo/);
    });

    it("rejects a malformed packages entry (non-string path) with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        packages: [{ name: "web", path: 3 }],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/packages\[0\]\.path/);
    });

    it("rejects a non-string versionConstraint with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        versionConstraint: 2,
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/versionConstraint/);
    });

    it("rejects a non-object cliTools with CONFIG_ERROR", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        cliTools: { enabled: true, selected: ["ripgrep", 5] },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/cliTools\.selected/);
    });

    it("round-trips all 8 newly-validated optional fields through write + read (D1-23)", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "3.0.0",
        hatch3rVersion: "2.0.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor", "claude"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        versionConstraint: "^2.0.0",
        languages: ["typescript", "python"],
        repos: [{ owner: "acme", repo: "app", name: "app" }],
        packages: [{ name: "web", path: "packages/web" }],
        hooks: { enabled: true },
        models: { default: "opus", agents: { "hatch3r-researcher": "sonnet" } },
        claude: {
          permissions: { allow: ["Read", "Edit"], deny: ["Bash"] },
          teammateMode: "in-process",
          agentTeams: "ga",
        },
        cliTools: { enabled: true, selected: ["ripgrep", "jq"], overrides: { jq: { disabled: true, note: "duplicate" } } },
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.models?.agents?.["hatch3r-researcher"]).toBe("sonnet");
      expect(result!.claude?.teammateMode).toBe("in-process");
      expect(result!.cliTools?.selected).toEqual(["ripgrep", "jq"]);
      expect(result!.repos).toEqual([{ owner: "acme", repo: "app", name: "app" }]);
      expect(result!.packages).toEqual([{ name: "web", path: "packages/web" }]);
      expect(result!.hooks?.enabled).toBe(true);
      expect(result!.languages).toEqual(["typescript", "python"]);
      expect(result!.versionConstraint).toBe("^2.0.0");
    });
  });

  // F3.3-C1 (Cycle 10 Wave 1 Critical): validateManifest previously accepted
  // an entire class of malformed `mcp` shapes (array masquerading as object,
  // missing `servers`, non-array `servers`, mixed-type entries). Five
  // negative-path assertions below pin the tightened validator. The structural
  // pattern mirrors the `tools` validation already enforced at hatchJson.ts:246.
  describe("manifest validation (mcp sub-schema)", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-mcp-validate-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });
      return tempDir;
    }

    async function writeManifestJson(rootDir: string, data: unknown): Promise<void> {
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    }

    function baseManifest(): Record<string, unknown> {
      return {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      };
    }

    // Negative case 1: invalid schema shape — mcp is null. Pre-fix, the
    // validator short-circuited at `obj.mcp === null` and returned false here,
    // but never produced a structured HatchError because no test pinned it.
    it("rejects mcp=null with HatchError CONFIG_ERROR", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.mcp = null;
      await writeManifestJson(rootDir, data);
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    // Negative case 2: invalid schema shape — mcp is an array masquerading as
    // an object. `typeof [] === "object"` so the pre-fix validator accepted
    // this; the tightened validator rejects via Array.isArray(obj.mcp).
    it("rejects mcp=[] (array masquerading as object) with HatchError CONFIG_ERROR", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.mcp = [];
      await writeManifestJson(rootDir, data);
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    // Negative case 3: missing required field — mcp.servers is null. Adapters
    // call `manifest.mcp.servers.length` and threw TypeError pre-fix.
    it("rejects mcp.servers=null with HatchError CONFIG_ERROR", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.mcp = { servers: null };
      await writeManifestJson(rootDir, data);
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    // Negative case 4: unexpected type — mcp.servers is a number, not an array.
    it("rejects mcp.servers=123 (unexpected type) with HatchError CONFIG_ERROR", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.mcp = { servers: 123 };
      await writeManifestJson(rootDir, data);
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    // Negative case 5: mixed-type entries — mcp.servers contains a non-string.
    // Mirrors the per-entry guard already in place for `tools` at hatchJson.ts:246.
    it("rejects mcp.servers=[123, 'github'] (mixed-type entries) with HatchError CONFIG_ERROR", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.mcp = { servers: [123, "github"] };
      await writeManifestJson(rootDir, data);
      try {
        await readManifest(rootDir);
        throw new Error("expected throw did not occur");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).exitCode).toBe(65);
      }
    });

    // Positive control: a well-formed mcp block still loads. Pins the fact
    // that the tightened validator did not over-restrict the happy path.
    it("accepts well-formed mcp={ servers: ['github', 'context7'] }", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.mcp = { servers: ["github", "context7"] };
      await writeManifestJson(rootDir, data);
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.mcp.servers).toEqual(["github", "context7"]);
    });
  });

  // F3.3-H3 (Cycle 10 Wave 2): validateManifest has 9 optional sub-schema
  // branches; before this block only `tools` + `mcp` (F3.3-C1) + board +
  // worktree.extraPatterns were negative-tested. Six branches — costTracking,
  // customization, specs, workspace, managedFilesByAdapter, detected,
  // userContent — had zero malformed-input rejection coverage, so a malformed
  // manifest carrying any of those fields slipped through readManifest and
  // crashed downstream with TypeError instead of HatchError CONFIG_ERROR
  // (violates P1 actionable-errors + P6 trust-boundary). Each row below pins
  // one malformed branch; the validator must reject every one. Source of truth
  // for each guard: src/manifest/hatchJson.ts:312-404.
  describe("manifest validation — exhaustive sub-schema negative paths", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-subschema-validate-"));
      await mkdir(join(tempDir, ".hatch3r"), { recursive: true });
      return tempDir;
    }

    function baseManifest(): Record<string, unknown> {
      return {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      };
    }

    // [description, field, malformed value] — each value violates exactly one
    // guard in validateManifest's optional sub-schema branches.
    const malformed: Array<[string, string, unknown]> = [
      // costTracking (hatchJson.ts:312-324)
      ["costTracking is not an object", "costTracking", "nope"],
      ["costTracking.sessionBudget is not a number", "costTracking", { sessionBudget: "10" }],
      ["costTracking.warningThresholds is not an array", "costTracking", { warningThresholds: 0.5 }],
      ["costTracking.warningThresholds has a non-number entry", "costTracking", { warningThresholds: [0.5, "x"] }],
      ["costTracking.hardStop is not a boolean", "costTracking", { hardStop: "yes" }],
      // customization (hatchJson.ts:326-342)
      ["customization is not an object", "customization", 5],
      ["customization.schemaVersion is not 1", "customization", { schemaVersion: 2 }],
      ["customization.agents is an array (not a record)", "customization", { schemaVersion: 1, agents: [] }],
      ["customization.agents inner entry is not an object", "customization", { schemaVersion: 1, agents: { x: "scalar" } }],
      ["customization.integrations is an array", "customization", { schemaVersion: 1, integrations: [] }],
      // specs (hatchJson.ts:344-350)
      ["specs is not an object", "specs", "nope"],
      ["specs.paths is not an array", "specs", { paths: "x" }],
      ["specs.paths has a non-string entry", "specs", { paths: [1] }],
      ["specs.lastGenerated is not a string", "specs", { paths: [], lastGenerated: 123 }],
      // workspace (hatchJson.ts:352-367)
      ["workspace is not an object", "workspace", 1],
      ["workspace.rootPath is not a string", "workspace", { rootPath: 1, lastSync: "x", syncVersion: "x", workspaceChecksum: "x" }],
      ["workspace.excludedContent has a non-string entry", "workspace", { rootPath: "/r", lastSync: "x", syncVersion: "x", workspaceChecksum: "x", excludedContent: [1] }],
      // managedFilesByAdapter (hatchJson.ts:369-376)
      ["managedFilesByAdapter value is not an array", "managedFilesByAdapter", { cursor: "x" }],
      ["managedFilesByAdapter value has a non-string entry", "managedFilesByAdapter", { cursor: [1] }],
      // detected (hatchJson.ts:381-391)
      ["detected is not an object", "detected", "x"],
      ["detected.linters is not an array", "detected", { linters: "eslint" }],
      ["detected.linters has a non-string entry", "detected", { linters: [1] }],
      // conflicts (D14-13)
      ["conflicts is not an array", "conflicts", { dimension: "testFramework" }],
      ["conflicts[0] is not an object", "conflicts", ["nope"]],
      ["conflicts[0].dimension is not a string", "conflicts", [{ dimension: 1, tools: [], message: "x" }]],
      ["conflicts[0].message is not a string", "conflicts", [{ dimension: "testFramework", tools: [], message: 9 }]],
      ["conflicts[0].tools is not an array", "conflicts", [{ dimension: "testFramework", tools: "vitest", message: "x" }]],
      ["conflicts[0].tools has a non-string entry", "conflicts", [{ dimension: "testFramework", tools: [1], message: "x" }]],
      // userContent (hatchJson.ts:393-404)
      ["userContent is not an object", "userContent", 9],
      ["userContent.count is not a number", "userContent", { count: "1", lastModified: "x", types: {} }],
      ["userContent.lastModified is not a string", "userContent", { count: 1, lastModified: 0, types: {} }],
      ["userContent.types value is not a number", "userContent", { count: 1, lastModified: "x", types: { agents: "x" } }],
    ];

    for (const [desc, field, value] of malformed) {
      it(`rejects malformed ${field}: ${desc}`, async () => {
        const rootDir = await setup();
        const data = baseManifest();
        data[field] = value;
        await writeFile(
          join(rootDir, ".hatch3r", "hatch.json"),
          JSON.stringify(data, null, 2),
          "utf-8",
        );
        try {
          await readManifest(rootDir);
          throw new Error(`expected HatchError for malformed ${field} (${desc})`);
        } catch (e) {
          expect(e).toBeInstanceOf(HatchError);
          expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
          expect((e as HatchError).exitCode).toBe(65);
        }
      });
    }

    // Positive control: a manifest carrying well-formed instances of all six
    // previously-untested sub-schemas loads cleanly (the validator did not
    // over-restrict the happy path).
    it("accepts well-formed instances of all six previously-untested sub-schemas", async () => {
      const rootDir = await setup();
      const data = baseManifest();
      data.costTracking = { sessionBudget: 5, warningThresholds: [0.5, 0.9], hardStop: true };
      data.customization = { schemaVersion: 1, agents: { "hatch3r-reviewer": { enabled: true } }, integrations: {} };
      data.specs = { paths: ["specs/foo.md"], lastGenerated: "2026-05-27T00:00:00.000Z" };
      data.workspace = { rootPath: "/repo", lastSync: "2026-05-27T00:00:00.000Z", syncVersion: "3.0.0", workspaceChecksum: "abc", excludedContent: ["x"] };
      data.managedFilesByAdapter = { cursor: [".cursor/rules/a.mdc"] };
      data.detected = { linters: ["eslint"], testFrameworks: ["vitest"], ciProviders: ["github-actions"] };
      data.conflicts = [{ dimension: "testFramework", tools: ["jest", "vitest"], message: "two runners" }];
      data.userContent = { count: 2, lastModified: "2026-05-27T00:00:00.000Z", types: { agents: 1, rules: 1 } };
      await writeFile(
        join(rootDir, ".hatch3r", "hatch.json"),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.costTracking?.sessionBudget).toBe(5);
      expect(result!.detected?.linters).toEqual(["eslint"]);
      expect(result!.conflicts?.[0]!.tools).toEqual(["jest", "vitest"]);
    });
  });

  // 1.7.1: Bug fix for clean+reinit losing GitHub Projects v2 IDs and other
  // user/platform-specific manifest fields. Helpers below are the centralized
  // extract/apply pair called from src/cli/commands/clean.ts (capture path)
  // and src/cli/commands/init.ts (apply path, with existingManifest fallback).
  describe("extractPreservedManifestFields", () => {
    function makeBoard(overrides: Partial<BoardConfig> = {}): BoardConfig {
      return {
        owner: "acme",
        repo: "app",
        defaultBranch: "main",
        projectNumber: 42,
        statusFieldId: 99,
        statusOptions: {
          backlog: "PVTSSF_backlog",
          ready: "PVTSSF_ready",
          inProgress: "PVTSSF_in_progress",
          inReview: "PVTSSF_in_review",
          done: "PVTSSF_done",
        },
        labels: {
          types: ["type:bug"],
          executors: ["executor:agent"],
          statuses: ["status:triage"],
          meta: ["meta:board-overview"],
        },
        branchConvention: "{type}/{short-description}",
        areas: ["api", "ui"],
        ...overrides,
      };
    }

    function makeManifest(overrides: Partial<HatchManifest> = {}): HatchManifest {
      const base = createManifest({ tools: ["cursor"], owner: "acme", repo: "app" });
      return { ...base, ...overrides };
    }

    it("returns empty object for a minimal manifest without any preservable fields", () => {
      const manifest = makeManifest();
      expect(extractPreservedManifestFields(manifest)).toEqual({});
    });

    it("extracts board with full GitHub Projects v2 state", () => {
      const board = makeBoard();
      const manifest = makeManifest({ board });
      const result = extractPreservedManifestFields(manifest);
      expect(result.board).toEqual(board);
      expect(result.board?.projectNumber).toBe(42);
      expect(result.board?.statusFieldId).toBe(99);
      expect(result.board?.statusOptions.backlog).toBe("PVTSSF_backlog");
      expect(result.board?.areas).toEqual(["api", "ui"]);
    });

    it("extracts costTracking budgets", () => {
      const manifest = makeManifest({
        costTracking: { sessionBudget: 5, issueBudget: 25, currency: "USD", hardStop: true },
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.costTracking).toEqual({
        sessionBudget: 5,
        issueBudget: 25,
        currency: "USD",
        hardStop: true,
      });
    });

    it("extracts specs paths and lastGenerated", () => {
      const manifest = makeManifest({
        specs: { paths: ["docs/api.md", "docs/architecture.md"], lastGenerated: "2026-05-01" },
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.specs?.paths).toEqual(["docs/api.md", "docs/architecture.md"]);
      expect(result.specs?.lastGenerated).toBe("2026-05-01");
    });

    it("extracts userContent counters", () => {
      const manifest = makeManifest({
        userContent: { count: 3, lastModified: "2026-05-12T10:00:00Z", types: { agent: 1, skill: 2 } },
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.userContent?.count).toBe(3);
      expect(result.userContent?.types).toEqual({ agent: 1, skill: 2 });
    });

    it("extracts hooks, models, and claude extension config", () => {
      const manifest = makeManifest({
        hooks: { enabled: true },
        models: { default: "sonnet", agents: { researcher: "opus" } },
        claude: { permissions: { allow: ["Bash"] }, teammateMode: "auto" },
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.hooks).toEqual({ enabled: true });
      expect(result.models?.default).toBe("sonnet");
      expect(result.claude?.permissions?.allow).toEqual(["Bash"]);
    });

    it("extracts repos and packages workspace state", () => {
      const manifest = makeManifest({
        repos: [{ owner: "acme", repo: "lib", name: "shared-lib" }],
        packages: [{ name: "core", path: "packages/core" }],
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.repos).toHaveLength(1);
      expect(result.repos?.[0]?.repo).toBe("lib");
      expect(result.packages?.[0]?.name).toBe("core");
    });

    it("extracts workspace metadata", () => {
      const manifest = makeManifest({
        workspace: {
          rootPath: "..",
          lastSync: "2026-05-12T10:00:00Z",
          syncVersion: "1.7.0",
          workspaceChecksum: "sha256:abc",
          excludedContent: ["hatch3r-foo"],
        },
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.workspace?.rootPath).toBe("..");
      expect(result.workspace?.excludedContent).toEqual(["hatch3r-foo"]);
    });

    it("extracts worktree extras (extraPatterns + nodeModules) into a dedicated shape", () => {
      const manifest = makeManifest({
        worktree: { enabled: true, extraPatterns: [".custom/"], nodeModules: "skip" },
      });
      const result = extractPreservedManifestFields(manifest);
      expect(result.worktreeExtras).toEqual({
        extraPatterns: [".custom/"],
        nodeModules: "skip",
      });
    });

    it("omits worktreeExtras when worktree has only `enabled` set", () => {
      const manifest = makeManifest({ worktree: { enabled: true } });
      const result = extractPreservedManifestFields(manifest);
      expect(result.worktreeExtras).toBeUndefined();
    });
  });

  describe("applyPreservedManifestFields", () => {
    function makeBoard(overrides: Partial<BoardConfig> = {}): BoardConfig {
      return {
        owner: "acme",
        repo: "app",
        defaultBranch: "main",
        projectNumber: 42,
        statusFieldId: 99,
        statusOptions: {
          backlog: "PVTSSF_backlog",
          ready: null,
          inProgress: null,
          inReview: null,
          done: null,
        },
        labels: { types: [], executors: [], statuses: [], meta: [] },
        branchConvention: "{type}/{short-description}",
        areas: [],
        ...overrides,
      };
    }

    it("is a no-op when preserved is empty", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      const before = JSON.stringify(manifest);
      applyPreservedManifestFields(manifest, {});
      expect(JSON.stringify(manifest)).toBe(before);
    });

    it("preserves board.projectNumber, statusFieldId, statusOptions when no board exists yet", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      const preserved = makeBoard();
      applyPreservedManifestFields(manifest, { board: preserved });
      expect(manifest.board?.projectNumber).toBe(42);
      expect(manifest.board?.statusFieldId).toBe(99);
      expect(manifest.board?.statusOptions.backlog).toBe("PVTSSF_backlog");
    });

    it("lets init-supplied board.owner/repo/defaultBranch win over preserved values", () => {
      const manifest = createManifest({ tools: ["cursor"], owner: "new-owner", repo: "new-repo", defaultBranch: "develop" });
      const preserved = makeBoard({ owner: "old-owner", repo: "old-repo", defaultBranch: "main", projectNumber: 42 });
      applyPreservedManifestFields(manifest, { board: preserved });
      expect(manifest.board?.owner).toBe("new-owner");
      expect(manifest.board?.repo).toBe("new-repo");
      expect(manifest.board?.defaultBranch).toBe("develop");
      // But projectNumber, statusOptions etc. are preserved
      expect(manifest.board?.projectNumber).toBe(42);
      expect(manifest.board?.statusOptions.backlog).toBe("PVTSSF_backlog");
    });

    it("preserves board.areas and branchConvention", () => {
      const manifest = createManifest({ tools: ["cursor"], owner: "acme", repo: "app", defaultBranch: "main" });
      const preserved = makeBoard({ areas: ["api", "ui"], branchConvention: "{type}/{name}" });
      applyPreservedManifestFields(manifest, { board: preserved });
      expect(manifest.board?.areas).toEqual(["api", "ui"]);
      expect(manifest.board?.branchConvention).toBe("{type}/{name}");
    });

    it("preserves costTracking budgets", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      applyPreservedManifestFields(manifest, {
        costTracking: { sessionBudget: 10, currency: "EUR" },
      });
      expect(manifest.costTracking?.sessionBudget).toBe(10);
      expect(manifest.costTracking?.currency).toBe("EUR");
    });

    it("preserves specs, userContent, hooks, models, claude", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      applyPreservedManifestFields(manifest, {
        specs: { paths: ["docs/api.md"] },
        userContent: { count: 2, lastModified: "2026-05-12", types: { agent: 2 } },
        hooks: { enabled: true },
        models: { default: "opus" },
        claude: { teammateMode: "tmux" },
      });
      expect(manifest.specs?.paths).toEqual(["docs/api.md"]);
      expect(manifest.userContent?.count).toBe(2);
      expect(manifest.hooks?.enabled).toBe(true);
      expect(manifest.models?.default).toBe("opus");
      expect(manifest.claude?.teammateMode).toBe("tmux");
    });

    it("preserves repos, packages, workspace metadata", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      applyPreservedManifestFields(manifest, {
        repos: [{ owner: "acme", repo: "lib" }],
        packages: [{ name: "core", path: "packages/core" }],
        workspace: {
          rootPath: "..",
          lastSync: "2026-05-12T10:00:00Z",
          syncVersion: "1.7.0",
          workspaceChecksum: "sha256:abc",
        },
      });
      expect(manifest.repos).toHaveLength(1);
      expect(manifest.packages?.[0]?.name).toBe("core");
      expect(manifest.workspace?.rootPath).toBe("..");
    });

    it("applies worktree extras only when manifest.worktree.enabled is true", () => {
      // Worktree enabled: extras get applied.
      const enabled = createManifest({ tools: ["claude"], worktreeEnabled: true });
      applyPreservedManifestFields(enabled, {
        worktreeExtras: { extraPatterns: [".custom/"], nodeModules: "skip" },
      });
      expect(enabled.worktree?.extraPatterns).toEqual([".custom/"]);
      expect(enabled.worktree?.nodeModules).toBe("skip");

      // Worktree disabled (or absent): extras dropped, worktree config not materialized.
      const disabled = createManifest({ tools: ["cursor"], worktreeEnabled: false });
      applyPreservedManifestFields(disabled, {
        worktreeExtras: { extraPatterns: [".custom/"], nodeModules: "skip" },
      });
      expect(disabled.worktree).toBeUndefined();
    });

    it("round-trip: extract then apply reproduces the preserved subset", () => {
      const source: HatchManifest = {
        ...createManifest({ tools: ["claude"], owner: "acme", repo: "app", defaultBranch: "main", worktreeEnabled: true }),
        board: makeBoard({ projectNumber: 7, areas: ["a"] }),
        costTracking: { sessionBudget: 3 },
        specs: { paths: ["a.md"] },
      };
      const preserved = extractPreservedManifestFields(source);
      const target = createManifest({ tools: ["claude"], owner: "acme", repo: "app", defaultBranch: "main", worktreeEnabled: true });
      applyPreservedManifestFields(target, preserved);
      expect(target.board?.projectNumber).toBe(7);
      expect(target.board?.areas).toEqual(["a"]);
      expect(target.costTracking?.sessionBudget).toBe(3);
      expect(target.specs?.paths).toEqual(["a.md"]);
    });
  });

  // D3-M5 (Cycle 10 Wave-3 Medium rollover): `readCliToolsConfig` and
  // `readMaturityTier` were exported helpers with zero direct test coverage
  // — together they sit on the persistence boundary for two manifest
  // fields adapters consume on every sync. Pin the documented fallback
  // contracts here so a future refactor of the default sentinels surfaces
  // immediately.
  describe("readCliToolsConfig", () => {
    it("returns {enabled:false, selected:[]} when manifest.cliTools is absent (pre-1.7.5 manifest)", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      // Confirm the precondition: createManifest does not auto-populate the
      // CLI-tooling section.
      expect(manifest.cliTools).toBeUndefined();
      const cfg = readCliToolsConfig(manifest);
      expect(cfg).toEqual({ enabled: false, selected: [] });
    });

    it("passes the manifest's cliTools through verbatim when present", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      manifest.cliTools = { enabled: true, selected: ["ripgrep", "jq"] };
      const cfg = readCliToolsConfig(manifest);
      expect(cfg.enabled).toBe(true);
      expect(cfg.selected).toEqual(["ripgrep", "jq"]);
    });
  });

  describe("readMaturityTier", () => {
    it("returns DEFAULT_MATURITY_TIER when manifest is null", () => {
      expect(readMaturityTier(null)).toBe(DEFAULT_MATURITY_TIER);
    });

    it("returns DEFAULT_MATURITY_TIER when manifest is undefined", () => {
      expect(readMaturityTier(undefined)).toBe(DEFAULT_MATURITY_TIER);
    });

    it("returns DEFAULT_MATURITY_TIER when manifest.maturity is absent", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      expect(manifest.maturity).toBeUndefined();
      expect(readMaturityTier(manifest)).toBe(DEFAULT_MATURITY_TIER);
    });

    it("returns the manifest tier when set to a valid value", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      const tiers: MaturityTier[] = ["solo", "team", "scaleup", "enterprise"];
      for (const tier of tiers) {
        manifest.maturity = tier;
        expect(readMaturityTier(manifest)).toBe(tier);
      }
    });

    it("falls back to the default when a corrupt manifest carries an out-of-enum maturity", () => {
      // Defense-in-depth path: the persistence validator rejects bad values
      // at write time, but a hand-edited in-memory manifest can still reach
      // this function. Confirm the fallback fires.
      const manifest = createManifest({ tools: ["cursor"] });
      (manifest as unknown as { maturity: string }).maturity = "not-a-real-tier";
      expect(readMaturityTier(manifest)).toBe(DEFAULT_MATURITY_TIER);
    });
  });

  // D13-SA13.3-F13.3.3 / -F2: readConfidenceFloor resolves an explicit persisted
  // floor first (override wins), then a maturity-aware default — scaleup +
  // enterprise default "high", solo + team (and null/undefined manifests, which
  // resolve to "solo") default DEFAULT_CONFIDENCE_FLOOR ("any"). This implements
  // the calibration the orchestrator docs already promised; an out-of-enum
  // persisted value collapses to the tier default (defense-in-depth).
  describe("readConfidenceFloor", () => {
    function withMaturity(tier: string): HatchManifest {
      const manifest = createManifest({ tools: ["cursor"] });
      (manifest as unknown as { maturity: string }).maturity = tier;
      return manifest;
    }

    it("defaults null / undefined manifests to DEFAULT_CONFIDENCE_FLOOR (solo tier)", () => {
      expect(readConfidenceFloor(null)).toBe(DEFAULT_CONFIDENCE_FLOOR);
      expect(readConfidenceFloor(undefined)).toBe(DEFAULT_CONFIDENCE_FLOOR);
    });

    it("defaults solo + team tiers to DEFAULT_CONFIDENCE_FLOOR when the field is absent", () => {
      const solo = createManifest({ tools: ["cursor"] });
      expect(solo.confidenceFloor).toBeUndefined();
      expect(solo.maturity).toBeUndefined(); // absent → readMaturityTier → "solo"
      expect(readConfidenceFloor(solo)).toBe(DEFAULT_CONFIDENCE_FLOOR);
      expect(readConfidenceFloor(withMaturity("solo"))).toBe("any");
      expect(readConfidenceFloor(withMaturity("team"))).toBe("any");
    });

    it("defaults scaleup + enterprise tiers to 'high' when the field is absent", () => {
      const scaleup = withMaturity("scaleup");
      const enterprise = withMaturity("enterprise");
      expect(scaleup.confidenceFloor).toBeUndefined();
      expect(enterprise.confidenceFloor).toBeUndefined();
      expect(readConfidenceFloor(scaleup)).toBe("high");
      expect(readConfidenceFloor(enterprise)).toBe("high");
    });

    it("honors an explicit persisted floor over the maturity-aware default", () => {
      const floors: ConfidenceFloor[] = ["any", "medium", "high"];
      for (const floor of floors) {
        // An enterprise tier would default to "high"; an explicit floor wins.
        const manifest = withMaturity("enterprise");
        manifest.confidenceFloor = floor;
        expect(readConfidenceFloor(manifest)).toBe(floor);
      }
    });

    it("returns the manifest floor when set to a valid value", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      const floors: ConfidenceFloor[] = ["any", "medium", "high"];
      for (const floor of floors) {
        manifest.confidenceFloor = floor;
        expect(readConfidenceFloor(manifest)).toBe(floor);
      }
    });

    it("falls back to the tier default when a corrupt manifest carries an out-of-enum floor", () => {
      const solo = createManifest({ tools: ["cursor"] });
      (solo as unknown as { confidenceFloor: string }).confidenceFloor = "paranoid";
      expect(readConfidenceFloor(solo)).toBe(DEFAULT_CONFIDENCE_FLOOR);

      const enterprise = withMaturity("enterprise");
      (enterprise as unknown as { confidenceFloor: string }).confidenceFloor = "paranoid";
      expect(readConfidenceFloor(enterprise)).toBe("high");
    });
  });

  // D3-M5 (Cycle 10 Wave-3 Medium rollover): pin the git-branch-name
  // validator at the persistence boundary. The validator covers a handful
  // of `git check-ref-format` rules and each one is a separate branch in
  // hatchJson.ts; without direct unit coverage these branches drove the
  // 72.56% statements score the finding flagged.
  describe("isValidGitBranchName", () => {
    it("accepts the common cases", () => {
      expect(isValidGitBranchName("main")).toBe(true);
      expect(isValidGitBranchName("feature/foo-bar")).toBe(true);
      expect(isValidGitBranchName("release/2.0.0")).toBe(true);
    });

    it("rejects empty or whitespace-only names", () => {
      expect(isValidGitBranchName("")).toBe(false);
      expect(isValidGitBranchName("   ")).toBe(false);
      expect(isValidGitBranchName(" main")).toBe(false);
    });

    it("rejects names with disallowed characters", () => {
      expect(isValidGitBranchName("foo~bar")).toBe(false);
      expect(isValidGitBranchName("foo^bar")).toBe(false);
      expect(isValidGitBranchName("foo:bar")).toBe(false);
      expect(isValidGitBranchName("foo\\bar")).toBe(false);
      expect(isValidGitBranchName("foo bar")).toBe(false);
      expect(isValidGitBranchName("foo\x01bar")).toBe(false);
    });

    it("rejects names with `..` or `//` or `@{`", () => {
      expect(isValidGitBranchName("foo..bar")).toBe(false);
      expect(isValidGitBranchName("foo//bar")).toBe(false);
      expect(isValidGitBranchName("foo@{bar}")).toBe(false);
    });

    it("rejects names starting/ending with `/` or `.`", () => {
      expect(isValidGitBranchName("/foo")).toBe(false);
      expect(isValidGitBranchName("foo/")).toBe(false);
      expect(isValidGitBranchName(".foo")).toBe(false);
      expect(isValidGitBranchName("foo.")).toBe(false);
    });

    it("rejects names ending with `.lock`", () => {
      expect(isValidGitBranchName("foo.lock")).toBe(false);
      expect(isValidGitBranchName("feature/x.lock")).toBe(false);
    });

    it("rejects the special-case `@`", () => {
      expect(isValidGitBranchName("@")).toBe(false);
    });
  });
});
