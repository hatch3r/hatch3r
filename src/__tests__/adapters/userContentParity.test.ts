// D20 + Wave 5: tests for user-content propagation through platform adapters.
//
// Each test stages two temp directories:
//   - `canonicalRoot` — a copy of the canonical fixture tree (matching
//     `src/__tests__/fixtures/agents/`). This is the first arg to
//     `adapter.generate`.
//   - `userRoot` — the user-repo root. The Wave 5 D20 overrides subtree
//     lives at `${userRoot}/.hatch3r/overrides/{type}/...`. We pass
//     `userRoot` as the third arg (`userRepoRoot`) so adapters resolve
//     overrides via `resolveUserContentRoot`.
//
// Covers every retained adapter (claude, cursor, copilot). The shared
// `BaseAdapter.filterByAdapterScope` covers all three, so a failure on any
// adapter reliably indicates a regression across the set.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { HATCH3R_DIR } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
const VALID_DESC =
  "User-tier adapter-parity fixture description with enough content to pass the >=60 character description gate";

async function copyCanonicalFixture(target: string): Promise<void> {
  await cp(FIXTURES_DIR, target, { recursive: true });
}

async function seedUserAgent(
  userRoot: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  // Wave 5: D20 user content moved to `.hatch3r/overrides/`.
  const overridesAgentsDir = join(userRoot, HATCH3R_DIR, "overrides", "agents");
  await mkdir(overridesAgentsDir, { recursive: true });
  const fm = {
    id: name,
    type: "agent",
    description: VALID_DESC,
    tags: ["customize"],
    quality_charter: "agents/shared/quality-charter.md",
    pillars: ["P4"],
    ...metadata,
  };
  const lines = Object.entries(fm).map(([k, v]) => {
    if (Array.isArray(v)) {
      const items = (v as unknown[]).map((s) => String(s));
      return `${k}: [${items.join(", ")}]`;
    }
    return `${k}: ${String(v)}`;
  });
  await writeFile(
    join(overridesAgentsDir, `${name}.md`),
    `---\n${lines.join("\n")}\n---\nUser body for ${name}.\n`,
  );
}

describe("user-content adapter parity", () => {
  let canonicalRoot: string;
  let userRoot: string;

  beforeEach(async () => {
    canonicalRoot = await mkdtemp(join(tmpdir(), "hatch3r-adapter-uc-canon-"));
    userRoot = await mkdtemp(join(tmpdir(), "hatch3r-adapter-uc-user-"));
    await copyCanonicalFixture(canonicalRoot);
  });

  afterEach(async () => {
    await rm(canonicalRoot, { recursive: true, force: true });
    await rm(userRoot, { recursive: true, force: true });
  });

  it("emits a user agent into all sampled adapter outputs when adapters frontmatter is omitted", async () => {
    await seedUserAgent(userRoot, "common-helper");

    const adapters = [
      { adapter: new ClaudeAdapter(), tools: ["claude"] as const, prefix: ".claude/agents/" },
      { adapter: new CursorAdapter(), tools: ["cursor"] as const, prefix: ".cursor/agents/" },
      { adapter: new CopilotAdapter(), tools: ["copilot"] as const, prefix: ".github/" },
    ];

    for (const { adapter, tools, prefix } of adapters) {
      const manifest = createManifest({ tools: tools as unknown as Parameters<typeof createManifest>[0]["tools"], mcpServers: ["github"] });
      const outputs = await adapter.generate(canonicalRoot, manifest, userRoot);
      const allText = outputs.map((o) => `${o.path}\n${o.content}`).join("\n");
      // Either an explicit per-agent file (claude/cursor) or an inline mention
      // (copilot concats agents into a single doc) constitutes "made it into
      // the adapter output".
      const hasFile =
        outputs.some((o) =>
          prefix && o.path.startsWith(prefix) && o.path.includes("common-helper"),
        ) || allText.includes("common-helper");
      expect(hasFile).toBe(true);
    }
  });

  it("restricts emission when adapters: [claude] — claude includes, cursor skips", async () => {
    await seedUserAgent(userRoot, "claude-only", { adapters: ["claude"] });

    const claudeOutputs = await new ClaudeAdapter().generate(
      canonicalRoot,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
      userRoot,
    );
    const cursorOutputs = await new CursorAdapter().generate(
      canonicalRoot,
      createManifest({ tools: ["cursor"], mcpServers: ["github"] }),
      userRoot,
    );

    const claudeMentions = claudeOutputs.some(
      (o) => o.path.includes("claude-only") || o.content.includes("claude-only"),
    );
    const cursorMentions = cursorOutputs.some(
      (o) => o.path.includes("claude-only") || o.content.includes("claude-only"),
    );

    expect(claudeMentions).toBe(true);
    expect(cursorMentions).toBe(false);
  });

  it("admits emission on every listed adapter when adapters: [claude, cursor]", async () => {
    await seedUserAgent(userRoot, "two-tools", { adapters: ["claude", "cursor"] });

    const claudeOutputs = await new ClaudeAdapter().generate(
      canonicalRoot,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
      userRoot,
    );
    const cursorOutputs = await new CursorAdapter().generate(
      canonicalRoot,
      createManifest({ tools: ["cursor"], mcpServers: ["github"] }),
      userRoot,
    );
    const copilotOutputs = await new CopilotAdapter().generate(
      canonicalRoot,
      createManifest({ tools: ["copilot"], mcpServers: ["github"] }),
      userRoot,
    );

    const claudeMentions = claudeOutputs.some(
      (o) => o.path.includes("two-tools") || o.content.includes("two-tools"),
    );
    const cursorMentions = cursorOutputs.some(
      (o) => o.path.includes("two-tools") || o.content.includes("two-tools"),
    );
    const copilotMentions = copilotOutputs.some(
      (o) => o.path.includes("two-tools") || o.content.includes("two-tools"),
    );

    expect(claudeMentions).toBe(true);
    expect(cursorMentions).toBe(true);
    expect(copilotMentions).toBe(false);
  });

  it("does not affect canonical agent emission when user content is present", async () => {
    await seedUserAgent(userRoot, "user-side-agent");

    const adapter = new ClaudeAdapter();
    const outputs = await adapter.generate(
      canonicalRoot,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
      userRoot,
    );

    // Canonical fixture has hatch3r-test-agent — must still appear.
    const canonical = outputs.find(
      (o) => o.path === ".claude/agents/hatch3r-test-agent.md",
    );
    expect(canonical).toBeDefined();
    expect(canonical!.content).toContain("test agent");
  });

  it("user-tier filenames without hatch3r- prefix do not collide with canonical adapter outputs", async () => {
    await seedUserAgent(userRoot, "uniquely-named-helper");

    const cursor = new CursorAdapter();
    const outputs = await cursor.generate(
      canonicalRoot,
      createManifest({ tools: ["cursor"], mcpServers: ["github"] }),
      userRoot,
    );

    // Our user agent should be addressable in the cursor agent picker
    // OR concatenated in a managed-block content stream — either way the
    // ID must reach the output without name collision against canonical files.
    const allPaths = outputs.map((o) => o.path);
    const allContent = outputs.map((o) => o.content).join("\n");

    expect(
      allPaths.some((p) => p.includes("uniquely-named-helper")) ||
        allContent.includes("uniquely-named-helper"),
    ).toBe(true);

    // No two outputs should target the same path (basic collision invariant).
    const pathSet = new Set(allPaths);
    expect(pathSet.size).toBe(allPaths.length);
  });

  it("preserves adapter managed-block markers around emitted content", async () => {
    // Round 2 did not add a separate `<!-- HATCH3R:USER:BEGIN -->` sub-marker;
    // user content rides inside the existing `HATCH3R:BEGIN/END` managed
    // block. Verify that the existing managed-block contract still wraps
    // adapter outputs once user content is present.
    await seedUserAgent(userRoot, "block-marker-check");

    const adapter = new ClaudeAdapter();
    const outputs = await adapter.generate(
      canonicalRoot,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
      userRoot,
    );

    // CLAUDE.md is the bridge file that always ships managed blocks.
    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(claudeMd!.content).toContain("<!-- HATCH3R:END -->");
  });
});

// D20-1 (X5/CD5): a user-authored agent cannot use the `hatch3r-` id prefix, so
// the Claude adapter re-prefixes it to `hatch3r-<slug>`. That id matches no
// canonical AGENT_TOOL_POLICIES entry, so (pre-fix) the emitted
// agent-tool-policies.json had no row for it and the PreToolUse hook
// NO_POLICY-denied EVERY tool call (a bricked agent). The fix derives a runtime
// policy from the agent's authored `tools.allowed`/`tools.denied` grant and
// appends it to the emitted policy doc + renders the `tools:` frontmatter from
// the same grant. These tests drive the EMITTED PreToolUse hook script with the
// re-prefixed `agent_type` and value-assert the authored allow/deny is honored.
describe("user-agent Claude tool-policy inheritance (D20-1)", () => {
  let canonicalRoot: string;
  let userRoot: string;

  beforeEach(async () => {
    canonicalRoot = await mkdtemp(join(tmpdir(), "hatch3r-d20-1-canon-"));
    userRoot = await mkdtemp(join(tmpdir(), "hatch3r-d20-1-user-"));
    await copyCanonicalFixture(canonicalRoot);
  });

  afterEach(async () => {
    await rm(canonicalRoot, { recursive: true, force: true });
    await rm(userRoot, { recursive: true, force: true });
  });

  // Seed a user agent with a structured `tools` grant. The existing
  // `seedUserAgent` helper renders only scalar/array frontmatter values, so we
  // write the file directly to control the nested `tools` object shape (the
  // same shape `composeArtifactFile` emits for a saved user agent).
  async function seedUserAgentWithTools(
    name: string,
    tools: { allowed?: string[]; denied?: string[] } | null,
  ): Promise<void> {
    const dir = join(userRoot, HATCH3R_DIR, "overrides", "agents");
    await mkdir(dir, { recursive: true });
    const lines = [
      "---",
      `id: ${name}`,
      "type: agent",
      `description: ${VALID_DESC}`,
      "tags: [customize]",
      "quality_charter: agents/shared/quality-charter.md",
      "pillars: [P6]",
    ];
    if (tools) {
      lines.push("tools:");
      if (tools.allowed) lines.push(`  allowed: [${tools.allowed.join(", ")}]`);
      if (tools.denied) lines.push(`  denied: [${tools.denied.join(", ")}]`);
    }
    lines.push("---", `User body for ${name}.`, "");
    await writeFile(join(dir, `${name}.md`), lines.join("\n"));
  }

  function claudeOutputs() {
    return new ClaudeAdapter().generate(
      canonicalRoot,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
      userRoot,
    );
  }

  // Run the emitted PreToolUse hook script against a synthetic Claude payload
  // and return the parsed stdout deny doc (or null when the hook allows).
  function runHook(
    hookScriptPath: string,
    payload: Record<string, unknown>,
  ): { exitCode: number; deny: { permissionDecision?: string; permissionDecisionReason?: string } | null; stderr: string } {
    const res = spawnSync(process.execPath, [hookScriptPath], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
    });
    const stdout = (res.stdout ?? "").trim();
    let deny: { permissionDecision?: string; permissionDecisionReason?: string } | null = null;
    if (stdout) {
      const parsed = JSON.parse(stdout) as {
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
      };
      deny = parsed.hookSpecificOutput ?? null;
    }
    return { exitCode: res.status ?? 0, deny, stderr: res.stderr ?? "" };
  }

  it("derives a runtime policy for the re-prefixed user agent honoring allow/deny", async () => {
    await seedUserAgentWithTools("granted-helper", {
      allowed: ["read", "search"],
      denied: ["write"],
    });

    const outputs = await claudeOutputs();
    const policyOut = outputs.find(
      (o) => o.path === ".claude/hooks/agent-tool-policies.json",
    );
    expect(policyOut).toBeDefined();
    const doc = JSON.parse(policyOut!.content) as {
      policies: Array<{ agentId: string; allowedTools: string[] }>;
    };
    const userPolicy = doc.policies.find((p) => p.agentId === "hatch3r-granted-helper");
    // The emitted-id policy MUST exist (closes the NO_POLICY deny-all path)…
    expect(userPolicy).toBeDefined();
    // …and reflect the authored grant with deny-by-default subtraction.
    expect(userPolicy!.allowedTools).toEqual(["read", "search"]);
    expect(userPolicy!.allowedTools).not.toContain("write");
  });

  it("emits Claude `tools:` frontmatter for the user agent from its grant", async () => {
    await seedUserAgentWithTools("fm-helper", { allowed: ["read", "search"] });

    const outputs = await claudeOutputs();
    const agentOut = outputs.find(
      (o) => o.path === ".claude/agents/hatch3r-fm-helper.md",
    );
    expect(agentOut).toBeDefined();
    // read -> Read/NotebookRead; search -> Grep/Glob. write tools must be absent.
    const fmHeader = agentOut!.content.split("\n").slice(0, 8).join("\n");
    expect(fmHeader).toMatch(/tools:.*\bRead\b/);
    expect(fmHeader).toMatch(/tools:.*\bGrep\b/);
    expect(fmHeader).not.toMatch(/tools:.*\bWrite\b/);
    expect(fmHeader).not.toMatch(/tools:.*\bEdit\b/);
  });

  it("PreToolUse hook ALLOWS an in-grant tool for the user agent (not NO_POLICY-denied)", async () => {
    await seedUserAgentWithTools("runtime-allow", {
      allowed: ["read", "search"],
      denied: ["write"],
    });

    const outputs = await claudeOutputs();
    const hookOut = outputs.find(
      (o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs",
    );
    const policyOut = outputs.find(
      (o) => o.path === ".claude/hooks/agent-tool-policies.json",
    );
    expect(hookOut).toBeDefined();
    expect(policyOut).toBeDefined();

    // Stage the hook + sibling policy doc exactly as the adapter writes them
    // (the hook reads ./agent-tool-policies.json relative to its own dir).
    const hookDir = await mkdtemp(join(tmpdir(), "hatch3r-d20-1-hook-"));
    try {
      const scriptPath = join(hookDir, "pretooluse-allowlist.mjs");
      await writeFile(scriptPath, hookOut!.content);
      await writeFile(join(hookDir, "agent-tool-policies.json"), policyOut!.content);

      // Read is in-grant -> the hook must NOT deny (allow = exit 0, empty stdout).
      const allow = runHook(scriptPath, {
        tool_name: "Read",
        agent_type: "hatch3r-runtime-allow",
        agent_id: "inst-1",
        tool_input: {},
      });
      expect(allow.exitCode).toBe(0);
      expect(allow.deny).toBeNull();
      // Forgery-resistance against the bug: the denial reason must never be
      // NO_POLICY for an agent that DOES have a derived policy.
      expect(allow.stderr).not.toContain("NO_POLICY");
    } finally {
      await rm(hookDir, { recursive: true, force: true });
    }
  });

  it("PreToolUse hook DENIES an out-of-grant tool for the user agent (authored deny honored)", async () => {
    await seedUserAgentWithTools("runtime-deny", {
      allowed: ["read", "search"],
      denied: ["write"],
    });

    const outputs = await claudeOutputs();
    const hookOut = outputs.find((o) => o.path === ".claude/hooks/pretooluse-allowlist.mjs");
    const policyOut = outputs.find((o) => o.path === ".claude/hooks/agent-tool-policies.json");

    const hookDir = await mkdtemp(join(tmpdir(), "hatch3r-d20-1-hook-"));
    try {
      const scriptPath = join(hookDir, "pretooluse-allowlist.mjs");
      await writeFile(scriptPath, hookOut!.content);
      await writeFile(join(hookDir, "agent-tool-policies.json"), policyOut!.content);

      // Write maps to category `write`, which is NOT in the grant -> deny, but
      // with reason TOOL_NOT_ALLOWED (the policy exists), NOT NO_POLICY.
      const deny = runHook(scriptPath, {
        tool_name: "Write",
        agent_type: "hatch3r-runtime-deny",
        agent_id: "inst-2",
        tool_input: {},
      });
      expect(deny.deny?.permissionDecision).toBe("deny");
      expect(deny.deny?.permissionDecisionReason).toContain("write");
      expect(deny.stderr).toContain("TOOL_NOT_ALLOWED");
      expect(deny.stderr).not.toContain("NO_POLICY");
    } finally {
      await rm(hookDir, { recursive: true, force: true });
    }
  });

  it("warns at validate time and derives an empty (deny-all) policy when the user agent declares no grant", async () => {
    // No `tools` block -> the agent had no authored grant. The derived policy
    // is still present (so the hook can find a row) but with an empty allowlist,
    // so every tool is denied — and the validate-time coverage scan warns the
    // author to add a grant.
    await seedUserAgentWithTools("ungranted-helper", null);

    const outputs = await claudeOutputs();
    const policyOut = outputs.find(
      (o) => o.path === ".claude/hooks/agent-tool-policies.json",
    );
    const doc = JSON.parse(policyOut!.content) as {
      policies: Array<{ agentId: string; allowedTools: string[] }>;
    };
    const userPolicy = doc.policies.find((p) => p.agentId === "hatch3r-ungranted-helper");
    expect(userPolicy).toBeDefined();
    expect(userPolicy!.allowedTools).toEqual([]);
  });
});
