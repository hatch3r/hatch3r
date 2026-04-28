// D20: tests for user-content propagation through platform adapters.
//
// Each test stages a fresh fixture directory at `${tempDir}` containing a
// minimal canonical layout (matching `src/__tests__/fixtures/agents/`) plus
// a user subtree under `${tempDir}/user/`. We then call `adapter.generate`
// directly with the temp dir as `agentsDir`, and assert on the resulting
// AdapterOutput[].
//
// We intentionally test a representative sample of adapters (claude, cursor,
// copilot, aider) rather than all 16 to keep the suite under a sane runtime.
// The shared `BaseAdapter.filterByAdapterScope` covers every adapter, so a
// failure on one of these representatives reliably indicates a regression
// across the whole set.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { CopilotAdapter } from "../../adapters/copilot.js";
import { AiderAdapter } from "../../adapters/aider.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
const VALID_DESC =
  "User-tier adapter-parity fixture description with enough content to pass the >=60 character description gate";

async function copyCanonicalFixture(target: string): Promise<void> {
  await cp(FIXTURES_DIR, target, { recursive: true });
}

async function seedUserAgent(
  agentsDir: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const userAgentsDir = join(agentsDir, "user", "agents");
  await mkdir(userAgentsDir, { recursive: true });
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
    join(userAgentsDir, `${name}.md`),
    `---\n${lines.join("\n")}\n---\nUser body for ${name}.\n`,
  );
}

describe("user-content adapter parity", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-adapter-uc-"));
    await copyCanonicalFixture(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("emits a user agent into all sampled adapter outputs when adapters frontmatter is omitted", async () => {
    await seedUserAgent(tempDir, "common-helper");

    const adapters = [
      { adapter: new ClaudeAdapter(), tools: ["claude"] as const, prefix: ".claude/agents/" },
      { adapter: new CursorAdapter(), tools: ["cursor"] as const, prefix: ".cursor/agents/" },
      { adapter: new CopilotAdapter(), tools: ["copilot"] as const, prefix: ".github/" },
      { adapter: new AiderAdapter(), tools: ["aider"] as const, prefix: "" },
    ];

    for (const { adapter, tools, prefix } of adapters) {
      const manifest = createManifest({ tools: tools as unknown as Parameters<typeof createManifest>[0]["tools"], mcpServers: ["github"] });
      const outputs = await adapter.generate(tempDir, manifest);
      const allText = outputs.map((o) => `${o.path}\n${o.content}`).join("\n");
      // Either an explicit per-agent file (claude/cursor) or an inline mention
      // (copilot/aider concat their agents into a single doc) constitutes
      // "made it into the adapter output".
      const hasFile =
        outputs.some((o) =>
          prefix && o.path.startsWith(prefix) && o.path.includes("common-helper"),
        ) || allText.includes("common-helper");
      expect(hasFile).toBe(true);
    }
  });

  it("restricts emission when adapters: [claude] — claude includes, cursor skips", async () => {
    await seedUserAgent(tempDir, "claude-only", { adapters: ["claude"] });

    const claudeOutputs = await new ClaudeAdapter().generate(
      tempDir,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
    );
    const cursorOutputs = await new CursorAdapter().generate(
      tempDir,
      createManifest({ tools: ["cursor"], mcpServers: ["github"] }),
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
    await seedUserAgent(tempDir, "two-tools", { adapters: ["claude", "cursor"] });

    const claudeOutputs = await new ClaudeAdapter().generate(
      tempDir,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
    );
    const cursorOutputs = await new CursorAdapter().generate(
      tempDir,
      createManifest({ tools: ["cursor"], mcpServers: ["github"] }),
    );
    const aiderOutputs = await new AiderAdapter().generate(
      tempDir,
      createManifest({ tools: ["aider"], mcpServers: ["github"] }),
    );

    const claudeMentions = claudeOutputs.some(
      (o) => o.path.includes("two-tools") || o.content.includes("two-tools"),
    );
    const cursorMentions = cursorOutputs.some(
      (o) => o.path.includes("two-tools") || o.content.includes("two-tools"),
    );
    const aiderMentions = aiderOutputs.some(
      (o) => o.path.includes("two-tools") || o.content.includes("two-tools"),
    );

    expect(claudeMentions).toBe(true);
    expect(cursorMentions).toBe(true);
    expect(aiderMentions).toBe(false);
  });

  it("does not affect canonical agent emission when user content is present", async () => {
    await seedUserAgent(tempDir, "user-side-agent");

    const adapter = new ClaudeAdapter();
    const outputs = await adapter.generate(
      tempDir,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
    );

    // Canonical fixture has hatch3r-test-agent — must still appear.
    const canonical = outputs.find(
      (o) => o.path === ".claude/agents/hatch3r-test-agent.md",
    );
    expect(canonical).toBeDefined();
    expect(canonical!.content).toContain("test agent");
  });

  it("user-tier filenames without hatch3r- prefix do not collide with canonical adapter outputs", async () => {
    await seedUserAgent(tempDir, "uniquely-named-helper");

    const cursor = new CursorAdapter();
    const outputs = await cursor.generate(
      tempDir,
      createManifest({ tools: ["cursor"], mcpServers: ["github"] }),
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
    await seedUserAgent(tempDir, "block-marker-check");

    const adapter = new ClaudeAdapter();
    const outputs = await adapter.generate(
      tempDir,
      createManifest({ tools: ["claude"], mcpServers: ["github"] }),
    );

    // CLAUDE.md is the bridge file that always ships managed blocks.
    const claudeMd = outputs.find((o) => o.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.content).toContain("<!-- HATCH3R:BEGIN -->");
    expect(claudeMd!.content).toContain("<!-- HATCH3R:END -->");
  });
});
