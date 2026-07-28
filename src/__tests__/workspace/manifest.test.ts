import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readWorkspaceManifest,
  writeWorkspaceManifest,
  createWorkspaceManifest,
  isUnsafeRepoPath,
} from "../../workspace/manifest.js";
import { HATCH3R_DIR, DEFAULT_FEATURES, HatchError } from "../../types.js";

// Wave 6: manifest moved from `.agents/` to `.hatch3r/`. The workspace
// manifest tracks `workspace.json` under the same directory.
const AGENTS_DIR = HATCH3R_DIR;

describe("workspace manifest", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    return tempDir;
  }

  const minimalDefaults = {
    platform: "github" as const,
    tools: ["cursor" as const],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: ["github"] },
    content: {
      preset: "standard" as const,
      projectType: "brownfield" as const,
      teamSize: "solo" as const,
      items: {
        agents: ["hatch3r-researcher"],
        skills: [],
        rules: [],
        commands: [],
        prompts: [],
        hooks: [],
        githubAgents: [],
      },
    },
  };

  describe("createWorkspaceManifest", () => {
    it("creates manifest with correct version", () => {
      const manifest = createWorkspaceManifest("test-ws", minimalDefaults, [], "manual");
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.name).toBe("test-ws");
      expect(manifest.repos).toEqual([]);
      expect(manifest.syncStrategy).toBe("manual");
    });

    it("includes repos and defaults", () => {
      const repos = [
        { path: "api", name: "api", sync: true },
        { path: "web", name: "web", sync: false },
      ];
      const manifest = createWorkspaceManifest("my-project", minimalDefaults, repos, "on-sync");
      expect(manifest.repos).toHaveLength(2);
      expect(manifest.repos[0].sync).toBe(true);
      expect(manifest.repos[1].sync).toBe(false);
      expect(manifest.syncStrategy).toBe("on-sync");
      expect(manifest.defaults.tools).toEqual(["cursor"]);
    });
  });

  describe("writeWorkspaceManifest / readWorkspaceManifest", () => {
    it("round-trips manifest to disk", async () => {
      const dir = await setup();
      const original = createWorkspaceManifest("round-trip", minimalDefaults, [
        { path: "repo-a", name: "repo-a", sync: true },
      ], "manual");

      await writeWorkspaceManifest(dir, original);
      const read = await readWorkspaceManifest(dir);

      expect(read).not.toBeNull();
      expect(read!.name).toBe("round-trip");
      expect(read!.repos).toHaveLength(1);
      expect(read!.repos[0].path).toBe("repo-a");
      expect(read!.defaults.tools).toEqual(["cursor"]);
    });

    it("returns null when no manifest exists", async () => {
      const dir = await setup();
      const result = await readWorkspaceManifest(dir);
      expect(result).toBeNull();
    });

    it("writes valid JSON", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("json-check", minimalDefaults, [], "manual");
      await writeWorkspaceManifest(dir, manifest);

      const raw = await readFile(join(dir, AGENTS_DIR, "workspace.json"), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("preserves repo overrides", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("overrides", minimalDefaults, [
        {
          path: "api",
          name: "api",
          sync: true,
          overrides: {
            tools: ["claude"],
            contentOverrides: {
              include: ["hatch3r-security"],
              exclude: ["hatch3r-researcher"],
            },
          },
        },
      ], "manual");

      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);

      expect(read!.repos[0].overrides?.tools).toEqual(["claude"]);
      expect(read!.repos[0].overrides?.contentOverrides?.include).toEqual(["hatch3r-security"]);
      expect(read!.repos[0].overrides?.contentOverrides?.exclude).toEqual(["hatch3r-researcher"]);
    });

    it("round-trips manifest with per-repo git identity", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("identity-test", minimalDefaults, [
        {
          path: "api",
          name: "api",
          sync: true,
          owner: "acme-corp",
          repo: "api-service",
          defaultBranch: "develop",
          platform: "github",
        },
        {
          path: "infra",
          name: "infra",
          sync: false,
          owner: "ops-team",
          repo: "infra",
          defaultBranch: "main",
          platform: "gitlab",
        },
      ], "manual");

      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);

      expect(read).not.toBeNull();
      expect(read!.repos[0].owner).toBe("acme-corp");
      expect(read!.repos[0].repo).toBe("api-service");
      expect(read!.repos[0].defaultBranch).toBe("develop");
      expect(read!.repos[0].platform).toBe("github");
      expect(read!.repos[1].owner).toBe("ops-team");
      expect(read!.repos[1].repo).toBe("infra");
      expect(read!.repos[1].platform).toBe("gitlab");
    });

    it("validates old-format manifests without git identity fields", async () => {
      const dir = await setup();
      // Create manifest without per-repo identity (old format)
      const manifest = createWorkspaceManifest("old-format", minimalDefaults, [
        { path: "api", name: "api", sync: true },
      ], "manual");

      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);

      expect(read).not.toBeNull();
      expect(read!.repos[0].owner).toBeUndefined();
      expect(read!.repos[0].repo).toBeUndefined();
      expect(read!.repos[0].defaultBranch).toBeUndefined();
      expect(read!.repos[0].platform).toBeUndefined();
    });

    it("rejects manifest with path traversal in repo path", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "evil-workspace",
        repos: [{ path: "../../etc/passwd", sync: true }],
        defaults: minimalDefaults,
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    it("rejects manifest with absolute repo path", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "evil-workspace",
        repos: [{ path: "/etc/passwd", sync: true }],
        defaults: minimalDefaults,
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    // D3-M8 (Cycle 10 Wave-3 Medium rollover): workspace/manifest.ts measured
    // 66.3% statements — three error-handling branches in
    // `readWorkspaceManifest` and the schema validator had no direct test.
    // Cover each so a future schema-tightening change fails loudly instead
    // of silently dropping rejection.

    it("throws a HatchError with `Malformed JSON` when the manifest file is not valid JSON", async () => {
      const dir = await setup();
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), "{ not valid");
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Malformed JSON");
    });

    it("rejects a manifest with the wrong syncStrategy value", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "bad-sync",
        repos: [],
        defaults: minimalDefaults,
        syncStrategy: "auto", // not in the allowed list ("manual" | "on-sync")
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    it("rejects a manifest with malformed cliTools selected entries", async () => {
      // Force the cliTools sub-schema's per-element string check to fire.
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.7.5",
        name: "bad-cli",
        repos: [],
        defaults: {
          ...minimalDefaults,
          cliTools: { enabled: true, selected: [123, "ripgrep"] },
        },
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    it("rejects a manifest missing the required defaults block", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "no-defaults",
        repos: [],
        // defaults intentionally omitted
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    // D2-SA2.5-05: #108 parity — the workspace reader must reject retired tool
    // ids at the boundary the way the repo-manifest reader does, instead of
    // letting a pre-1.9.0 id (windsurf, cline, ...) reach getAdapter during
    // sync where its structured HatchError.recoveryHint is dropped.

    it("rejects a stale tool id in defaults.tools with a supported-tools recoveryHint", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "stale-defaults",
        repos: [],
        defaults: { ...minimalDefaults, tools: ["windsurf"] },
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);

      let caught: unknown;
      try {
        await readWorkspaceManifest(dir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HatchError);
      const hatchErr = caught as HatchError;
      expect(hatchErr.message).toContain("windsurf");
      expect(hatchErr.message).toContain("Supported tools: claude, cursor, copilot");
      expect(hatchErr.errorCode).toBe("VALIDATION_ERROR");
      // Parity with #108: the recoveryHint survives to the top-level handler
      // rather than being flattened away like the sync-loop warning path.
      expect(hatchErr.recoveryHint).toBeDefined();
      expect(hatchErr.recoveryHint).toContain("cursor");
    });

    it("rejects an unknown tool id in a per-repo override", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "stale-override",
        repos: [{ path: "api", name: "api", sync: true, overrides: { tools: ["cline"] } }],
        defaults: minimalDefaults,
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow(/overrides\.tools.*cline/);
    });

    it("rejects an unknown tool id in a group delta", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "stale-group",
        repos: [],
        defaults: { ...minimalDefaults, groups: { "sec-lead": { tools: ["windsurf"] } } },
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow(/groups\.sec-lead\.tools.*windsurf/);
    });

    it("accepts a manifest whose defaults, group, and override tools are all supported", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "all-valid-tools",
        repos: [{ path: "api", name: "api", sync: true, overrides: { tools: ["copilot"] } }],
        defaults: { ...minimalDefaults, groups: { core: { tools: ["claude"] } } },
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);

      const read = await readWorkspaceManifest(dir);
      expect(read).not.toBeNull();
      expect(read!.defaults.tools).toEqual(["cursor"]);
      expect(read!.defaults.groups?.core.tools).toEqual(["claude"]);
      expect(read!.repos[0].overrides?.tools).toEqual(["copilot"]);
    });
  });

  // ── DD-C2/C3/C4 (release/2.8.5): ingress hardening ───────────────────────
  describe("DD-C2 duplicate repo paths (normalized)", () => {
    it("rejects two entries whose paths normalize to the same directory ('api' vs './api'), naming both", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("dup", minimalDefaults, [
        { path: "api", sync: true },
        { path: "./api", sync: true },
      ], "manual");
      await writeWorkspaceManifest(dir, manifest);

      let caught: unknown;
      try {
        await readWorkspaceManifest(dir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HatchError);
      const err = caught as HatchError;
      expect(err.errorCode).toBe("VALIDATION_ERROR");
      expect(err.message).toContain('"api"');
      expect(err.message).toContain('"./api"');
      expect(err.message).toContain("duplicate");
    });

    it("rejects a trailing-slash duplicate ('api' vs 'api/')", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("dup-slash", minimalDefaults, [
        { path: "api", sync: true },
        { path: "api/", sync: true },
      ], "manual");
      await writeWorkspaceManifest(dir, manifest);

      await expect(readWorkspaceManifest(dir)).rejects.toMatchObject({
        errorCode: "VALIDATION_ERROR",
        message: expect.stringContaining("duplicate"),
      });
    });

    it("accepts genuinely distinct paths", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("distinct", minimalDefaults, [
        { path: "api", sync: true },
        { path: "api-service", sync: true },
        { path: "services/api", sync: true },
      ], "manual");
      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);
      expect(read?.repos).toHaveLength(3);
    });
  });

  describe("DD-C3 version gate + migration registry", () => {
    it("rejects a major-newer manifest (2.0.0) with an upgrade hint, before shape validation", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("future", minimalDefaults, [], "manual");
      const doctored = { ...manifest, version: "2.0.0" };
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify(doctored, null, 2),
        "utf-8",
      );

      let caught: unknown;
      try {
        await readWorkspaceManifest(dir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HatchError);
      const err = caught as HatchError;
      expect(err.errorCode).toBe("CONFIG_ERROR");
      expect(err.message).toContain("2.0.0");
      expect(err.recoveryHint).toMatch(/upgrade hatch3r/i);
    });

    it("accepts a same-major minor-newer version (1.5.0)", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("minor", minimalDefaults, [], "manual");
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify({ ...manifest, version: "1.5.0" }, null, 2),
        "utf-8",
      );
      const read = await readWorkspaceManifest(dir);
      expect(read?.version).toBe("1.5.0");
    });

    it("the migration registry exists, is idempotent, and returns a deep copy", async () => {
      const { WORKSPACE_MANIFEST_MIGRATIONS, migrateWorkspaceManifest } = await import(
        "../../workspace/manifest.js"
      );
      expect(Array.isArray(WORKSPACE_MANIFEST_MIGRATIONS)).toBe(true);
      const input = { version: "1.0.0", nested: { keep: true } };
      const once = migrateWorkspaceManifest(input);
      const twice = migrateWorkspaceManifest(once);
      expect(twice).toEqual(once);
      expect(once).not.toBe(input); // pure — caller's object untouched
      expect(once.nested).not.toBe(input.nested);
    });
  });

  describe("DD-C4 per-field errors + unknown-field advisory", () => {
    it("accumulates EVERY defect with its field path in one pass", async () => {
      const dir = await setup();
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify({
          version: "1.0.0",
          hatch3rVersion: "2.8.5",
          name: 42, // wrong type
          syncStrategy: "sometimes", // outside the enum
          repos: [{ path: "api" }], // missing sync
          defaults: { tools: "cursor", features: {}, mcp: { servers: [] } }, // tools not array
        }),
        "utf-8",
      );

      let caught: unknown;
      try {
        await readWorkspaceManifest(dir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HatchError);
      const msg = (caught as HatchError).message;
      expect(msg).toContain("`name`");
      expect(msg).toContain("`syncStrategy`");
      expect(msg).toContain("`repos[0].sync`");
      expect(msg).toContain("`defaults.tools`");
    });

    it("collectWorkspaceManifestErrors returns [] for a valid manifest (guard parity)", async () => {
      const { collectWorkspaceManifestErrors } = await import("../../workspace/manifest.js");
      const manifest = createWorkspaceManifest("ok", minimalDefaults, [{ path: "api", sync: true }], "manual");
      expect(collectWorkspaceManifestErrors(manifest)).toEqual([]);
      expect(collectWorkspaceManifestErrors(null)).not.toEqual([]);
      expect(collectWorkspaceManifestErrors([])).not.toEqual([]);
    });

    it("unknown top-level + defaults fields surface through onWarn, never reject", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("unknown", minimalDefaults, [], "manual");
      const doctored = {
        ...manifest,
        repoes: [], // typo'd key
        defaults: { ...manifest.defaults, futureKnob: true },
      };
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify(doctored, null, 2),
        "utf-8",
      );

      const warnings: string[] = [];
      const read = await readWorkspaceManifest(dir, { onWarn: (m) => warnings.push(m) });
      expect(read).not.toBeNull(); // advisory, not a rejection
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("repoes");
      expect(warnings[0]).toContain("defaults.futureKnob");
    });

    it("no advisory for a fully-known manifest (and the param stays optional)", async () => {
      const dir = await setup();
      await writeWorkspaceManifest(dir, createWorkspaceManifest("clean", minimalDefaults, [], "manual"));
      const warnings: string[] = [];
      await readWorkspaceManifest(dir, { onWarn: (m) => warnings.push(m) });
      expect(warnings).toEqual([]);
      // Legacy single-argument call still compiles/works.
      expect(await readWorkspaceManifest(dir)).not.toBeNull();
    });
  });

  // DD-A (release/2.8.5): the workspace-manifest writer takes a REAL lock by
  // default — no env var, no enable call (the pre-2.8.5 shape needed
  // enableDefaultCrossProcessLocking() or HATCH3R_LOCK=1).
  describe("DD-A1 real lock with no env var", () => {
    it("writeWorkspaceManifest contends on a pre-held workspace.json lock → LOCK_TIMEOUT", async () => {
      const orig = process.env.HATCH3R_LOCK;
      delete process.env.HATCH3R_LOCK;
      try {
        const dir = await setup();
        const lockDir = join(dir, AGENTS_DIR, "workspace.json.hatch3r.lock");
        await mkdir(lockDir, { recursive: true });

        await expect(
          writeWorkspaceManifest(dir, createWorkspaceManifest("locked", minimalDefaults, [], "manual")),
        ).rejects.toMatchObject({ name: "HatchError", errorCode: "LOCK_TIMEOUT" });
      } finally {
        if (orig === undefined) delete process.env.HATCH3R_LOCK;
        else process.env.HATCH3R_LOCK = orig;
      }
    }, 20_000);
  });

  describe("isUnsafeRepoPath", () => {
    it("rejects path traversal with ..", () => {
      expect(isUnsafeRepoPath("../secret")).toBe(true);
      expect(isUnsafeRepoPath("../../etc/passwd")).toBe(true);
      expect(isUnsafeRepoPath("foo/../../../bar")).toBe(true);
    });

    it("rejects absolute paths", () => {
      expect(isUnsafeRepoPath("/etc/passwd")).toBe(true);
      expect(isUnsafeRepoPath("/root/.ssh/id_rsa")).toBe(true);
    });

    it("rejects paths with null bytes", () => {
      expect(isUnsafeRepoPath("foo\0bar")).toBe(true);
    });

    it("allows safe relative paths", () => {
      expect(isUnsafeRepoPath("api")).toBe(false);
      expect(isUnsafeRepoPath("services/api")).toBe(false);
      expect(isUnsafeRepoPath("web-app")).toBe(false);
    });
  });
});
