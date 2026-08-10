import { describe, it, expect } from "vitest";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { CodexAdapter } from "../../adapters/codex.js";
import {
  AGENTS_MD_OWNER_PRIORITY,
  AGENTS_MD_PATH,
  buildAgentsMdBody,
  buildAgentsMdOutput,
  resolveAgentsMdOwner,
} from "../../adapters/agentsMd.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { AgentsMdConfig, HatchManifest, Tool } from "../../types.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

/**
 * D9-SA9.5-05 (Cycle 12 CL-2 U6): opt-in root AGENTS.md output class.
 * Spec: .audit-workspace/content-specs/agentsmd-output-class.spec.md
 */

function makeManifest(tools: Tool[], agentsMd?: AgentsMdConfig): HatchManifest {
  const base = createManifest({ tools });
  return agentsMd ? { ...base, agentsMd } : base;
}

function adapterFor(tool: Tool) {
  switch (tool) {
    case "claude":
      return new ClaudeAdapter();
    case "cursor":
      return new CursorAdapter();
    case "copilot":
      return new CopilotAdapter();
    case "codex":
      return new CodexAdapter();
  }
}

/** Count lines that trim to exactly `token` — mirrors line-anchored marker detection. */
function countLineAnchored(content: string, token: string): number {
  return content.split("\n").filter((line) => line.trim() === token).length;
}

describe("agentsMd output class (D9-SA9.5-05)", () => {
  describe("off by default — provably off", () => {
    it.each<Tool>(["claude", "cursor", "copilot"])(
      "%s adapter emits no AGENTS.md when the manifest has no agentsMd key",
      async (tool) => {
        const outputs = await adapterFor(tool).generate(FIXTURES_DIR, makeManifest([tool]));
        expect(outputs.find((o) => o.path === AGENTS_MD_PATH)).toBeUndefined();
      },
    );

    it("Codex emits its native AGENTS.md projection independently of the optional shared bridge", async () => {
      const outputs = await new CodexAdapter().generate(FIXTURES_DIR, makeManifest(["codex"]));
      expect(outputs.find((o) => o.path === AGENTS_MD_PATH)).toBeDefined();
    });

    it("emits no AGENTS.md when enabled is false", async () => {
      const manifest = makeManifest(["claude"], { enabled: false });
      const outputs = await new ClaudeAdapter().generate(FIXTURES_DIR, manifest);
      expect(outputs.find((o) => o.path === AGENTS_MD_PATH)).toBeUndefined();
    });

    it("stays off for non-boolean-true enabled values (strict === true gate)", () => {
      // A hand-edited .hatch3r/hatch.json can carry any JSON value; only
      // boolean true activates the class.
      for (const value of ["true", 1, {}, [], null] as unknown[]) {
        const manifest = makeManifest(["claude"], { enabled: value as boolean });
        expect(resolveAgentsMdOwner(manifest)).toBeUndefined();
      }
    });

    it("resolves no owner when enabled but no supported tool is selected", () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      manifest.tools = [];
      expect(resolveAgentsMdOwner(manifest)).toBeUndefined();
    });
  });

  describe("owner election — single writer across a multi-tool sync", () => {
    it("elects codex first so its native AGENTS.md projection remains the sole writer", () => {
      expect(AGENTS_MD_OWNER_PRIORITY).toEqual(["codex", "claude", "cursor", "copilot"]);
      expect(resolveAgentsMdOwner(makeManifest(["codex", "copilot", "cursor", "claude"], { enabled: true }))).toBe("codex");
      expect(resolveAgentsMdOwner(makeManifest(["codex", "copilot", "cursor"], { enabled: true }))).toBe("codex");
      expect(resolveAgentsMdOwner(makeManifest(["codex", "copilot"], { enabled: true }))).toBe("codex");
      expect(resolveAgentsMdOwner(makeManifest(["codex"], { enabled: true }))).toBe("codex");
    });

    it("only the elected owner emits AGENTS.md; the other adapters emit none", async () => {
      const manifest = makeManifest(["claude", "cursor", "copilot", "codex"], { enabled: true });
      const [claudeOut, cursorOut, copilotOut, codexOut] = await Promise.all([
        new ClaudeAdapter().generate(FIXTURES_DIR, manifest),
        new CursorAdapter().generate(FIXTURES_DIR, manifest),
        new CopilotAdapter().generate(FIXTURES_DIR, manifest),
        new CodexAdapter().generate(FIXTURES_DIR, manifest),
      ]);
      expect(claudeOut.find((o) => o.path === AGENTS_MD_PATH)).toBeUndefined();
      expect(cursorOut.find((o) => o.path === AGENTS_MD_PATH)).toBeUndefined();
      expect(copilotOut.find((o) => o.path === AGENTS_MD_PATH)).toBeUndefined();
      expect(codexOut.find((o) => o.path === AGENTS_MD_PATH)).toBeDefined();
    });

    it("a non-claude owner emits when claude is not selected", async () => {
      const manifest = makeManifest(["cursor"], { enabled: true });
      const outputs = await new CursorAdapter().generate(FIXTURES_DIR, manifest);
      expect(outputs.find((o) => o.path === AGENTS_MD_PATH)).toBeDefined();
    });

    it("codex emits AGENTS.md when it is the only selected owner", async () => {
      const manifest = makeManifest(["codex"], { enabled: true });
      const outputs = await new CodexAdapter().generate(FIXTURES_DIR, manifest);
      expect(outputs.find((o) => o.path === AGENTS_MD_PATH)).toBeDefined();
    });
  });

  describe("on-with-flag output shape", () => {
    it("wraps the whole content in the markdown/HTML managed-block variant", async () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      const outputs = await new ClaudeAdapter().generate(FIXTURES_DIR, manifest);
      const agentsMd = outputs.find((o) => o.path === AGENTS_MD_PATH);
      expect(agentsMd).toBeDefined();
      expect(agentsMd!.content.startsWith(`${MANAGED_BLOCK_START}\n`)).toBe(true);
      expect(agentsMd!.content.endsWith(`${MANAGED_BLOCK_END}\n`)).toBe(true);
      // Survives BaseAdapter's managedContent-substring invariant (not dropped).
      expect(agentsMd!.managedContent).toBeDefined();
      expect(agentsMd!.content).toContain(agentsMd!.managedContent!.trim());
    });

    it("marker-token prose mentions never occupy their own line (line-anchored safety)", () => {
      const out = buildAgentsMdOutput(makeManifest(["claude", "cursor", "copilot"], { enabled: true }));
      // Exactly the two real boundary lines — a third would corrupt merge.
      expect(countLineAnchored(out.content, MANAGED_BLOCK_START)).toBe(1);
      expect(countLineAnchored(out.content, MANAGED_BLOCK_END)).toBe(1);
    });

    it("declares config-only provenance (sourceFiles: []) so the broad fill never mis-attributes canonical reads", async () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      const outputs = await new ClaudeAdapter().generate(FIXTURES_DIR, manifest);
      const agentsMd = outputs.find((o) => o.path === AGENTS_MD_PATH);
      expect(agentsMd!.sourceFiles).toEqual([]);
    });

    it("is enumerated by getOutputPaths when enabled", async () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      const paths = await new ClaudeAdapter().getOutputPaths(FIXTURES_DIR, manifest);
      expect(paths).toContain(AGENTS_MD_PATH);
    });
  });

  describe("thin-pointer content (two-SSoT resolution)", () => {
    it("carries the universal floor + B1 directive + maturity tier", () => {
      const body = buildAgentsMdBody(makeManifest(["claude"], { enabled: true }));
      expect(body).toContain("Clarify before executing");
      expect(body).toContain("Security");
      expect(body).toContain("Testing");
      expect(body).toContain("universal floor");
      // Absence semantics: no manifest.maturity means solo.
      expect(body).toContain("Project maturity tier: `solo`");
    });

    it("reflects the manifest maturity tier when set", () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      manifest.maturity = "team";
      expect(buildAgentsMdBody(manifest)).toContain("Project maturity tier: `team`");
    });

    it("emits pointer rows for selected tools only", () => {
      const body = buildAgentsMdBody(makeManifest(["claude", "copilot"], { enabled: true }));
      expect(body).toContain("CLAUDE.md");
      expect(body).toContain(".github/copilot-instructions.md");
      // Cursor not selected: no cursor surface row.
      expect(body).not.toContain(".cursor/rules/hatch3r-bridge.mdc");
    });

    it("defers to platform-native surfaces and never inlines canonical bodies", async () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      const outputs = await new ClaudeAdapter().generate(FIXTURES_DIR, manifest);
      const agentsMd = outputs.find((o) => o.path === AGENTS_MD_PATH)!;
      expect(agentsMd.content).toContain("it is the source of truth and this summary defers to it");
      // Fixture canonical ids (rules + agents the same run DID read and emit
      // elsewhere) must not appear — the pointer file duplicates no bodies.
      expect(agentsMd.content).not.toContain("test-rule");
      expect(agentsMd.content).not.toContain("scoped-rule");
      expect(agentsMd.content).not.toContain("test-agent");
    });

    it("emitted bytes are a pure function of the manifest (owner-independent)", () => {
      const manifest = makeManifest(["cursor", "copilot"], { enabled: true });
      const a = buildAgentsMdOutput(manifest);
      const b = buildAgentsMdOutput(manifest);
      expect(a.content).toBe(b.content);
      expect(a.path).toBe(AGENTS_MD_PATH);
      expect(a.action).toBe("create");
    });
  });

  describe("error paths", () => {
    it("pre-aborted signal throws before any emission (inherited base contract)", async () => {
      const controller = new AbortController();
      controller.abort();
      const manifest = makeManifest(["claude"], { enabled: true });
      await expect(
        new ClaudeAdapter().generate(FIXTURES_DIR, manifest, undefined, "standard", controller.signal),
      ).rejects.toThrow();
    });

    it("tolerates a manifest with a missing tools array (defensive read)", () => {
      const manifest = makeManifest(["claude"], { enabled: true });
      // A hand-edited manifest can drop required fields; the resolver must
      // not throw — it reports no owner.
      (manifest as { tools?: Tool[] }).tools = undefined;
      expect(resolveAgentsMdOwner(manifest)).toBeUndefined();
      expect(() => buildAgentsMdBody(manifest)).not.toThrow();
    });
  });
});
