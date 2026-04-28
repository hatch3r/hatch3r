// D20: tests for the canonical+user merged catalog produced by
// `buildContentIndex(contentRoot, { userRoot })`. Each test sets up isolated
// canonical and user roots in a temp dir and asserts on the merged shape.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildContentIndex } from "../../content/index.js";

function md(
  metadata: Record<string, unknown>,
  body = "# body\n",
): string {
  const lines = Object.entries(metadata).map(([k, v]) => {
    if (Array.isArray(v)) {
      return `${k}: [${v.map((s) => String(s)).join(", ")}]`;
    }
    return `${k}: ${String(v)}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

async function seedCanonical(canonicalRoot: string): Promise<void> {
  await mkdir(join(canonicalRoot, "agents"), { recursive: true });
  await writeFile(
    join(canonicalRoot, "agents", "hatch3r-implementer.md"),
    md({
      id: "hatch3r-implementer",
      type: "agent",
      description: "Canonical implementer agent for the merged-index test fixture corpus",
      tags: ["core", "implementation"],
    }),
  );
  await writeFile(
    join(canonicalRoot, "agents", "hatch3r-reviewer.md"),
    md({
      id: "hatch3r-reviewer",
      type: "agent",
      description: "Canonical reviewer agent for the merged-index test fixture corpus",
      tags: ["core", "review"],
    }),
  );
  await mkdir(join(canonicalRoot, "rules"), { recursive: true });
  await writeFile(
    join(canonicalRoot, "rules", "hatch3r-rule.md"),
    md({
      id: "hatch3r-rule",
      type: "rule",
      description: "Canonical rule for merged-index test fixture corpus integration scenarios",
      tags: ["core"],
    }),
  );
}

async function seedUserAgent(
  userRoot: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(join(userRoot, "agents"), { recursive: true });
  await writeFile(
    join(userRoot, "agents", `${name}.md`),
    md({
      id: name,
      type: "agent",
      description:
        metadata.description ??
        `User-tier ${name} agent fixture for merged-index test scenarios in the D20 user-content suite`,
      tags: metadata.tags ?? ["core"],
      ...metadata,
    }),
  );
}

describe("buildContentIndex with userRoot", () => {
  let tempDir: string;
  let canonicalRoot: string;
  let userRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-bci-user-"));
    canonicalRoot = join(tempDir, "canonical");
    userRoot = join(tempDir, "user-root");
    await seedCanonical(canonicalRoot);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns canonical-only items when userRoot is undefined", async () => {
    const index = await buildContentIndex(canonicalRoot);
    expect(index.items.length).toBeGreaterThan(0);
    expect(index.items.every((i) => i.source === "canonical")).toBe(true);
  });

  it("matches canonical-only result when userRoot points at a non-existent path", async () => {
    const index = await buildContentIndex(canonicalRoot, { userRoot });
    // The user root never existed — index must still be canonical-only.
    expect(index.items.every((i) => i.source === "canonical")).toBe(true);
  });

  it("merges a user agent into the index with source: 'user'", async () => {
    await seedUserAgent(userRoot, "my-helper");

    const index = await buildContentIndex(canonicalRoot, { userRoot });
    const userItems = index.items.filter((i) => i.source === "user");
    expect(userItems).toHaveLength(1);
    expect(userItems[0].id).toBe("my-helper");
    expect(userItems[0].type).toBe("agent");

    const canonItems = index.items.filter((i) => i.source === "canonical");
    expect(canonItems.length).toBeGreaterThan(0);
    expect(canonItems.every((i) => i.source === "canonical")).toBe(true);
  });

  it("flags a user-shadow-canonical collision when a user id matches a canonical id", async () => {
    // Suppress the console.warn raised by the index builder for this case.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Seed a user file whose explicit id collides with hatch3r-implementer.
      await mkdir(join(userRoot, "agents"), { recursive: true });
      await writeFile(
        join(userRoot, "agents", "shadow.md"),
        md({
          id: "hatch3r-implementer",
          type: "agent",
          description:
            "User-tier shadow of hatch3r-implementer for the buildContentIndex collision test scenario",
          tags: ["core"],
        }),
      );

      const index = await buildContentIndex(canonicalRoot, { userRoot });
      expect(index.collisions.length).toBeGreaterThan(0);
      const userShadow = index.collisions.find(
        (c) => c.kind === "user-shadow-canonical",
      );
      expect(userShadow).toBeDefined();
      expect(userShadow!.id).toBe("hatch3r-implementer");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("parses inline `adapters: [...]` frontmatter on a user item", async () => {
    await seedUserAgent(userRoot, "scoped-agent", { adapters: ["claude", "cursor"] });

    const index = await buildContentIndex(canonicalRoot, { userRoot });
    const item = index.items.find((i) => i.source === "user" && i.id === "scoped-agent");
    expect(item).toBeDefined();
    expect(item!.adapters).toEqual(["claude", "cursor"]);
  });

  it("leaves item.adapters undefined when the frontmatter omits the field", async () => {
    await seedUserAgent(userRoot, "default-parity-agent");

    const index = await buildContentIndex(canonicalRoot, { userRoot });
    const item = index.items.find(
      (i) => i.source === "user" && i.id === "default-parity-agent",
    );
    expect(item).toBeDefined();
    expect(item!.adapters).toBeUndefined();
  });

  it("falls back gracefully when adapters frontmatter is malformed", async () => {
    // The line scanner only matches inline-array `adapters: [...]` or block
    // form `adapters:\n  - foo` shapes. A bare scalar `adapters: claude` does
    // not match either pattern and parseAdaptersFrontmatter returns null,
    // leaving item.adapters undefined.
    await mkdir(join(userRoot, "agents"), { recursive: true });
    await writeFile(
      join(userRoot, "agents", "weird-adapters.md"),
      md({
        id: "weird-adapters",
        type: "agent",
        description:
          "User-tier agent fixture with malformed adapters frontmatter for graceful-fallback test",
        tags: ["core"],
        adapters: "claude",
      }),
    );

    const index = await buildContentIndex(canonicalRoot, { userRoot });
    const item = index.items.find(
      (i) => i.source === "user" && i.id === "weird-adapters",
    );
    expect(item).toBeDefined();
    expect(item!.adapters).toBeUndefined();
  });

  it("preserves canonical-only behaviour when no user items are seeded", async () => {
    // Even when userRoot is set and exists, an empty user subtree must not
    // affect the canonical index shape.
    await mkdir(userRoot, { recursive: true });

    const onlyCanonical = await buildContentIndex(canonicalRoot);
    const merged = await buildContentIndex(canonicalRoot, { userRoot });

    // Counts and ids match exactly.
    expect(merged.items).toHaveLength(onlyCanonical.items.length);
    const canonIds = new Set(onlyCanonical.items.map((i) => i.id));
    const mergedIds = new Set(merged.items.map((i) => i.id));
    expect([...canonIds].sort()).toEqual([...mergedIds].sort());
  });
});
