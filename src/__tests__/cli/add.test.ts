import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";

/**
 * CL-2 U12 (D5-SA5.3-09): `hatch3r add` wired from roadmap stub to the v1
 * pack installer. Command-level coverage: probe contract, dry-run preview,
 * local-path + npm-package happy paths, trust-tier / traversal / lifecycle
 * refusals, and the exit-code contract.
 *
 * Preserved repaired semantics under test (C8-D1-M8 + D1-SA1.3-F2, sources
 * re-verified 2026-04-20: tldp.org/LDP/abs/html/exitcodes.html — exit 2 =
 * Bash misuse; man.freebsd.org sysexits — EX_OK = 0): a bare `hatch3r add`
 * probe invocation stays informational (exit 0, never a usage error), and
 * only real usage errors (invalid --format value) exit 2.
 */

const AGENT_BODY = [
  "---",
  "id: demo-agent",
  "type: agent",
  "description: Demo pack agent for add-command tests",
  "tags: [implementation]",
  "tools:",
  "  allow: [Read, Grep]",
  "---",
  "",
  "# Demo agent",
  "",
  "Reads repository files and reports findings.",
  "",
].join("\n");

const RULE_BODY = [
  "---",
  "id: demo-rule",
  "type: rule",
  "description: Demo pack rule for add-command tests",
  "tags: [maintenance]",
  "---",
  "",
  "Prefer named constants over magic numbers.",
  "",
].join("\n");

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pack_id: "demo-pack",
    version: "1.0.0",
    required_capabilities: ["agents", "rules"],
    tool_footprint: {
      max_agents: 2,
      max_skills: 0,
      max_rules: 2,
      max_commands: 0,
      max_hooks: 0,
      max_prompts: 0,
      max_checks: 0,
    },
    declared_tools: ["Read", "Grep"],
    mcp_servers: [],
    signing: { method: "cosign-keyless", identity: "ci@example.dev", transparency_log: "rekor-entry-1" },
    ...overrides,
  };
}

async function writePack(
  packDir: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = { "agents/demo-agent.md": AGENT_BODY, "rules/demo-rule.md": RULE_BODY },
): Promise<void> {
  await mkdir(packDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(packDir, ...rel.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf-8");
  }
  await writeFile(join(packDir, "pack-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

describe("add command", () => {
  let consoleSpy: MockInstance;
  let warnSpy: MockInstance;
  let stdoutSpy: MockInstance;
  let tempDir: string;
  let cwdSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-add-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
    stdoutSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function jsonOutput(): Record<string, unknown> {
    const raw = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  // ── Probe contract (C8-D1-M8 preserved) ──────────────────────

  it("bare invocation returns cleanly (exit 0) with a usage notice, never a usage error", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await expect(addCommand()).resolves.toBeUndefined();
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("hatch3r add <");
    expect(output).toContain("--dry-run");
  });

  it("bare invocation in JSON mode emits a single self-identifying envelope", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand(undefined, { format: "json" });
    const doc = jsonOutput();
    expect(doc.command).toBe("add");
    expect(doc.installed).toBe(false);
    expect(typeof doc.usage).toBe("string");
  });

  it("an invalid --format value is a real usage error (exit 2)", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    let caught: unknown;
    try {
      await addCommand("./my-pack", { format: "bogus" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).exitCode).toBe(2);
  });

  // ── Dry run ──────────────────────────────────────────────────

  it("--dry-run previews the trust-gated write set without writing anything", async () => {
    await writePack(join(tempDir, "my-pack"), baseManifest());
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand("./my-pack", { dryRun: true, format: "json" });
    const doc = jsonOutput();
    expect(doc.command).toBe("add");
    expect(doc.dryRun).toBe(true);
    expect(doc.pack).toBe("demo-pack");
    expect((doc.files as unknown[]).length).toBe(2);
    expect(existsSync(join(tempDir, ".hatch3r"))).toBe(false);
  });

  // ── Install happy paths ──────────────────────────────────────

  it("installs a local-path pack: overrides materialized + ledger recorded", async () => {
    await writePack(join(tempDir, "my-pack"), baseManifest());
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand("./my-pack", { format: "json" });
    const doc = jsonOutput();
    expect(doc.status).toBe("passed");
    expect(doc.command).toBe("add");
    expect(doc.source).toBe("local-path");
    const installed = await readFile(
      join(tempDir, ".hatch3r", "overrides", "agents", "demo-agent.md"),
      "utf-8",
    );
    expect(installed).toBe(AGENT_BODY);
    const ledger = JSON.parse(
      await readFile(join(tempDir, ".hatch3r", "packs", "demo-pack.json"), "utf-8"),
    );
    expect(ledger.pack_id).toBe("demo-pack");
    expect(ledger.files).toContain(".hatch3r/overrides/rules/demo-rule.md");
  });

  it("installs an npm-package pack resolved from node_modules (no fetch)", async () => {
    await writePack(join(tempDir, "node_modules", "demo-pack"), baseManifest());
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand("demo-pack", { format: "json" });
    const doc = jsonOutput();
    expect(doc.status).toBe("passed");
    expect(doc.source).toBe("npm-package");
    expect(existsSync(join(tempDir, ".hatch3r", "overrides", "rules", "demo-rule.md"))).toBe(true);
  });

  // ── Trust-tier rejection ─────────────────────────────────────

  it("refuses an unsigned pack with exit 73 unless --allow-untrusted is passed", async () => {
    await writePack(join(tempDir, "my-pack"), baseManifest({ signing: undefined }));
    const { addCommand } = await import("../../cli/commands/add.js");
    let caught: unknown;
    try {
      await addCommand("./my-pack", { format: "json" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).exitCode).toBe(73);
    expect((caught as HatchError).errorCode).toBe("INTEGRITY_ERROR");
    expect(existsSync(join(tempDir, ".hatch3r"))).toBe(false);

    await addCommand("./my-pack", { format: "json", allowUntrusted: true });
    const ledger = JSON.parse(
      await readFile(join(tempDir, ".hatch3r", "packs", "demo-pack.json"), "utf-8"),
    );
    expect(ledger.allowUntrusted).toBe(true);
  });

  // ── Traversal-guard rejection ────────────────────────────────

  it("refuses a pack whose integrity map carries a traversal path (exit 64)", async () => {
    await writePack(
      join(tempDir, "my-pack"),
      baseManifest({
        files: { "../evil.md": "a".repeat(64) },
      }),
    );
    const { addCommand } = await import("../../cli/commands/add.js");
    let caught: unknown;
    try {
      await addCommand("./my-pack", { format: "json" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).exitCode).toBe(64);
    expect((caught as HatchError).message).toMatch(/Path-traversal guard/);
    expect(existsSync(join(tempDir, ".hatch3r"))).toBe(false);
  });

  // ── Lifecycle-script rejection ───────────────────────────────

  it("refuses a pack with a banned lifecycle script (exit 65)", async () => {
    const packDir = join(tempDir, "my-pack");
    await writePack(packDir, baseManifest());
    await writeFile(
      join(packDir, "package.json"),
      JSON.stringify({ name: "demo-pack", scripts: { postinstall: "node evil.js" } }),
      "utf-8",
    );
    const { addCommand } = await import("../../cli/commands/add.js");
    let caught: unknown;
    try {
      await addCommand("./my-pack", { format: "json" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).exitCode).toBe(65);
    expect((caught as HatchError).message).toMatch(/LIFECYCLE_SCRIPT_BANNED/);
    expect(existsSync(join(tempDir, ".hatch3r"))).toBe(false);
  });

  // ── Validation rejection (exit-code contract) ────────────────

  it("refuses a missing pack source with exit 64", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    let caught: unknown;
    try {
      await addCommand("./does-not-exist", { format: "json" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HatchError);
    expect((caught as HatchError).exitCode).toBe(64);
    expect((caught as HatchError).errorCode).toBe("VALIDATION_ERROR");
  });
});
