import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator, scanBody, formatFinding } from "../validate-learnings-consultation-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ── scanBody: the detection heuristic (D6-SA6.5-01) ─────────────────
//
// Each `mis-keyed` string is a verbatim (or structurally identical) copy of a
// pre-migration command line the finding cites, so these prove the gate WOULD
// have fired on the exact defect it exists to prevent — a lint that never
// triggers proves nothing.
describe("scanBody — flags pre-migration mis-keys", () => {
  it("flags `Match by area and tags` in a learnings block", () => {
    const body = [
      "3. If `.hatch3r/learnings/` exists, scan for learnings relevant to the affected area. Match by area and tags against the bug brief.",
    ].join("\n");
    const f = scanBody(body, "commands/x.md");
    expect(f).toHaveLength(1);
    expect(f[0].line).toBe(1);
    expect(f[0].message).toMatch(/D6-SA6\.5-01/);
  });

  it("flags a two-line block: learnings context above, `area` and `tags` directive below", () => {
    const body = [
      "1. If `.hatch3r/learnings/` exists, scan for learnings relevant to the areas touched.",
      "2. Match by `area` and `tags` in learning frontmatter against the area labels.",
    ].join("\n");
    const f = scanBody(body, "commands/board-fill.md");
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.some((x) => x.line === 2)).toBe(true);
  });

  it("flags `Scan learning file frontmatter for `area` or `tags``", () => {
    const body = "2. Scan learning file frontmatter for `area` or `tags` that match the affected paths.";
    expect(scanBody(body, "commands/quick-change.md")).toHaveLength(1);
  });

  it("flags `matching areas or tags`", () => {
    const body = "If `.hatch3r/learnings/` exists, scan for learnings with matching areas or tags.";
    expect(scanBody(body, "commands/rework.md")).toHaveLength(1);
  });
});

describe("scanBody — passes migrated + unrelated lines", () => {
  it("does NOT flag a migrated line naming applies-to + topic", () => {
    const body =
      "3. If `.hatch3r/learnings/` exists, scan for relevant learnings — test the file paths against each learning's `applies-to` glob and the area against its `topic` (accept legacy `area`/`tags` only as a transitional fallback).";
    expect(scanBody(body, "commands/x.md")).toHaveLength(0);
  });

  it("does NOT flag a mis-key phrase when a canonical key sits within the window", () => {
    const body = [
      "scan `.hatch3r/learnings/` — test paths against each learning's `applies-to` glob;",
      "as a transitional fallback, also match by area and tags against the brief.",
    ].join("\n");
    // The `applies-to` on the line above clears the `match by area and tags` line.
    expect(scanBody(body, "commands/x.md")).toHaveLength(0);
  });

  it("does NOT flag an `area:*` issue-label line outside a learnings context", () => {
    const body = [
      "2. **Form new epics from 2+ related items.** Group items that share any",
      "   `area:*` label, same subsystem, or related feature domain. Match by area.",
    ].join("\n");
    expect(scanBody(body, "commands/board-fill.md")).toHaveLength(0);
  });

  it("does NOT flag the schema migration table (names topic + applies-to)", () => {
    const body =
      "| `category` + `area` + `tags` as match keys (learn skill / consult / loader) | `topic` (match key) + `applies-to` (path-glob binding) |";
    expect(scanBody(body, "rules/hatch3r-learning-system.md")).toHaveLength(0);
  });
});

// ── runValidator: fixture end-to-end + shipped-corpus regression ────

describe("validate-learnings-consultation-keys — fixture", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "learn-consult-keys-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports a mis-keyed command file and counts the scan", async () => {
    await mkdir(join(root, "commands"), { recursive: true });
    await writeFile(
      join(root, "commands", "hatch3r-x.md"),
      "#### Consult Learnings\n\nIf `.hatch3r/learnings/` exists, match by area and tags against the brief.\n",
      "utf-8",
    );
    const result = await runValidator({ rootDir: root, scanDirs: ["commands"] });
    expect(result.checkedFiles).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("commands/hatch3r-x.md");
    expect(formatFinding(result.findings[0])).toMatch(/LEARN-CONSULT-KEY/);
  });

  it("returns 0 findings for a migrated fixture", async () => {
    await mkdir(join(root, "commands"), { recursive: true });
    await writeFile(
      join(root, "commands", "hatch3r-y.md"),
      "If `.hatch3r/learnings/` exists, match each learning's `applies-to` glob and `topic`.\n",
      "utf-8",
    );
    const result = await runValidator({ rootDir: root, scanDirs: ["commands"] });
    expect(result.findings).toHaveLength(0);
  });
});

describe("validate-learnings-consultation-keys — shipped corpus", () => {
  it("emits 0 findings across the migrated corpus (D6-SA6.5-01)", async () => {
    const result = await runValidator({ rootDir: REPO_ROOT });
    expect(
      result.findings,
      result.findings.map((f) => `${f.file}:${f.line} ${f.text}`).join("\n"),
    ).toHaveLength(0);
    expect(result.checkedFiles).toBeGreaterThan(0);
  });
});
