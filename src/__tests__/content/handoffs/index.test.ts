import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveHandoff,
  buildHandoffIndex,
  listHandoffs,
  pruneHandoffs,
  readHandoff,
  REQUIRED_BODY_SECTIONS,
  writeHandoff,
  computeHandoffIntegrity,
  type Handoff,
} from "../../../content/handoffs/index.js";

// ── Fixture ──────────────────────────────────────────────────────

function buildBody(): string {
  return REQUIRED_BODY_SECTIONS.map((h) => `## ${h}\n\n- item\n`).join("\n");
}

function buildHandoff(over: Partial<Handoff["frontmatter"]> = {}, body?: string): Handoff {
  const finalBody = body ?? buildBody();
  return {
    frontmatter: {
      id: "2026-05-17_T1430_a3f2c_idx-test",
      type: "handoff",
      created: "2026-05-17T14:30:00.000Z",
      updated: "2026-05-17T14:30:00.000Z",
      status: "in-progress",
      source_agent: "hatch3r-implementer",
      target_agent: "hatch3r-reviewer",
      git_ref: "feature/x@a1b2c3d",
      branch: "feature/x",
      confidence: 0.8,
      completeness: 0.7,
      integrity: computeHandoffIntegrity(finalBody),
      ...over,
    },
    body: finalBody,
    filePath: "",
  };
}

// ── Test scaffold ────────────────────────────────────────────────

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hatch3r-handoffs-idx-"));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── writeHandoff ─────────────────────────────────────────────────

describe("writeHandoff", () => {
  it("creates active/<id>.md and round-trips through readHandoff", async () => {
    const h = buildHandoff();
    const { path } = await writeHandoff(tmpDir, h);
    expect(path).toBe(join(tmpDir, "handoffs", "active", `${h.frontmatter.id}.md`));
    const round = await readHandoff(tmpDir, h.frontmatter.id);
    expect(round).not.toBeNull();
    expect(round?.frontmatter.id).toBe(h.frontmatter.id);
    expect(round?.frontmatter.status).toBe("in-progress");
    expect(round?.body.includes("## Problem")).toBe(true);
  });

  it("leaves no .tmp orphan after a successful write", async () => {
    await writeHandoff(tmpDir, buildHandoff());
    const entries = await readdir(join(tmpDir, "handoffs", "active"));
    const orphans = entries.filter((e) => /\.tmp\./.test(e));
    expect(orphans).toEqual([]);
  });

  it("recomputes integrity from body bytes", async () => {
    const body = buildBody();
    const h = buildHandoff({ integrity: "sha256:" + "0".repeat(64) }, body);
    const { path } = await writeHandoff(tmpDir, h);
    const raw = await readFile(path, "utf-8");
    expect(raw).toContain(computeHandoffIntegrity(body));
    expect(raw).not.toContain("sha256:" + "0".repeat(64));
  });

  it("writes to archived/ when status is archived", async () => {
    const h = buildHandoff({ status: "archived" });
    const { path } = await writeHandoff(tmpDir, h);
    expect(path).toBe(join(tmpDir, "handoffs", "archived", `${h.frontmatter.id}.md`));
  });

  it("refuses to overwrite an existing handoff without allowOverwrite", async () => {
    const h = buildHandoff();
    await writeHandoff(tmpDir, h);
    await expect(writeHandoff(tmpDir, h)).rejects.toThrow(/already exists/i);
  });

  it("overwrites when allowOverwrite is true", async () => {
    const h = buildHandoff();
    await writeHandoff(tmpDir, h);
    const updatedBody = buildBody() + "\nNew content\n";
    const h2 = buildHandoff({}, updatedBody);
    await expect(writeHandoff(tmpDir, h2, { allowOverwrite: true })).resolves.toBeTruthy();
    const round = await readHandoff(tmpDir, h.frontmatter.id);
    expect(round?.body.includes("New content")).toBe(true);
  });
});

// ── listHandoffs ─────────────────────────────────────────────────

describe("listHandoffs", () => {
  it("returns empty array when handoffs dir is missing", async () => {
    const list = await listHandoffs(tmpDir);
    expect(list).toEqual([]);
  });

  it("lists active by default and ignores archived", async () => {
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1430_aaaaa_first" }),
    );
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1431_bbbbb_archived-one", status: "archived" }),
    );
    const list = await listHandoffs(tmpDir);
    expect(list.map((h) => h.frontmatter.id)).toEqual(["2026-05-17_T1430_aaaaa_first"]);
  });

  it("includes archived when includeArchived is true", async () => {
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1430_aaaaa_first" }),
    );
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1431_bbbbb_archived-one", status: "archived" }),
    );
    const list = await listHandoffs(tmpDir, { includeArchived: true });
    expect(list.map((h) => h.frontmatter.id).sort()).toEqual([
      "2026-05-17_T1430_aaaaa_first",
      "2026-05-17_T1431_bbbbb_archived-one",
    ]);
  });

  it("filters by status", async () => {
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1430_aaaaa_one", status: "in-progress" }),
    );
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1431_bbbbb_two", status: "blocked" }),
    );
    const blocked = await listHandoffs(tmpDir, { status: "blocked" });
    expect(blocked.map((h) => h.frontmatter.id)).toEqual(["2026-05-17_T1431_bbbbb_two"]);
  });

  it("filters by workItem", async () => {
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1430_aaaaa_one", work_item: "gh:owner/repo#42" }),
    );
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1431_bbbbb_two", work_item: "gh:owner/repo#99" }),
    );
    const list = await listHandoffs(tmpDir, { workItem: "gh:owner/repo#42" });
    expect(list.map((h) => h.frontmatter.id)).toEqual(["2026-05-17_T1430_aaaaa_one"]);
  });

  it("filters by branch", async () => {
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1430_aaaaa_one", branch: "feature/a" }),
    );
    await writeHandoff(
      tmpDir,
      buildHandoff({ id: "2026-05-17_T1431_bbbbb_two", branch: "feature/b" }),
    );
    const list = await listHandoffs(tmpDir, { branch: "feature/a" });
    expect(list.map((h) => h.frontmatter.id)).toEqual(["2026-05-17_T1430_aaaaa_one"]);
  });
});

// ── readHandoff ──────────────────────────────────────────────────

describe("readHandoff", () => {
  it("returns null for missing id", async () => {
    expect(await readHandoff(tmpDir, "nonexistent")).toBeNull();
  });

  it("finds an active handoff", async () => {
    const h = buildHandoff();
    await writeHandoff(tmpDir, h);
    const found = await readHandoff(tmpDir, h.frontmatter.id);
    expect(found?.frontmatter.id).toBe(h.frontmatter.id);
  });

  it("finds an archived handoff", async () => {
    const h = buildHandoff({ status: "archived" });
    await writeHandoff(tmpDir, h);
    const found = await readHandoff(tmpDir, h.frontmatter.id);
    expect(found?.frontmatter.id).toBe(h.frontmatter.id);
    expect(found?.frontmatter.status).toBe("archived");
  });
});

// ── archiveHandoff ───────────────────────────────────────────────

describe("archiveHandoff", () => {
  it("moves the file from active to archived", async () => {
    const h = buildHandoff();
    await writeHandoff(tmpDir, h);
    const { from, to } = await archiveHandoff(tmpDir, h.frontmatter.id, "completed");
    await expect(stat(from)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(to)).resolves.toBeTruthy();
  });

  it("updates status to archived and stamps updated", async () => {
    const h = buildHandoff();
    await writeHandoff(tmpDir, h);
    await archiveHandoff(tmpDir, h.frontmatter.id, "completed");
    const round = await readHandoff(tmpDir, h.frontmatter.id);
    expect(round?.frontmatter.status).toBe("archived");
    expect(round?.frontmatter.updated).not.toBe(h.frontmatter.updated);
  });

  it("sets superseded_by when reason is superseded", async () => {
    const h = buildHandoff();
    await writeHandoff(tmpDir, h);
    await archiveHandoff(tmpDir, h.frontmatter.id, "superseded", {
      supersededBy: "2026-05-18_T0900_ffffe_replacement",
    });
    const round = await readHandoff(tmpDir, h.frontmatter.id);
    expect(round?.frontmatter.superseded_by).toBe("2026-05-18_T0900_ffffe_replacement");
  });

  it("throws when no active handoff exists for the id", async () => {
    await expect(archiveHandoff(tmpDir, "missing-id", "manual")).rejects.toThrow(
      /no active handoff/i,
    );
  });
});

// ── pruneHandoffs ────────────────────────────────────────────────

describe("pruneHandoffs", () => {
  it("dry-run lists candidates without acting", async () => {
    const expired = buildHandoff({
      id: "2026-05-17_T1430_aaaaa_expired",
      expires_after: "2020-01-01T00:00:00.000Z",
    });
    await writeHandoff(tmpDir, expired);
    const r = await pruneHandoffs(tmpDir, {
      dryRun: true,
      now: new Date("2026-05-17T00:00:00Z"),
    });
    expect(r.archived).toEqual(["2026-05-17_T1430_aaaaa_expired"]);
    // File still in active/.
    const list = await listHandoffs(tmpDir);
    expect(list.length).toBe(1);
  });

  it("archives expired active handoffs and deletes old archived handoffs", async () => {
    const expired = buildHandoff({
      id: "2026-05-17_T1430_aaaaa_expired",
      expires_after: "2020-01-01T00:00:00.000Z",
    });
    await writeHandoff(tmpDir, expired);

    // Pre-existing archived handoff with old updated timestamp.
    const old = buildHandoff({
      id: "2025-01-01_T0900_ccccc_ancient",
      status: "archived",
      updated: "2025-01-01T09:00:00.000Z",
    });
    await writeHandoff(tmpDir, old);

    const now = new Date("2026-05-17T00:00:00Z");
    const r = await pruneHandoffs(tmpDir, { now, olderThanDays: 30 });
    expect(r.archived).toEqual(["2026-05-17_T1430_aaaaa_expired"]);
    expect(r.deleted).toContain("2025-01-01_T0900_ccccc_ancient");
    // Expired handoff is now in archived/.
    const archivedList = await listHandoffs(tmpDir, {
      includeArchived: true,
      status: "archived",
    });
    expect(archivedList.some((h) => h.frontmatter.id === "2026-05-17_T1430_aaaaa_expired")).toBe(
      true,
    );
    // Ancient one is gone.
    expect(
      archivedList.some((h) => h.frontmatter.id === "2025-01-01_T0900_ccccc_ancient"),
    ).toBe(false);
  });
});

// ── buildHandoffIndex ───────────────────────────────────────────

describe("buildHandoffIndex", () => {
  it("indexes active and archived by id, work_item, and branch", async () => {
    await writeHandoff(
      tmpDir,
      buildHandoff({
        id: "2026-05-17_T1430_aaaaa_one",
        branch: "feature/a",
        work_item: "gh:owner/repo#42",
      }),
    );
    await writeHandoff(
      tmpDir,
      buildHandoff({
        id: "2026-05-17_T1431_bbbbb_two",
        status: "archived",
        branch: "feature/b",
        work_item: "gh:owner/repo#42",
      }),
    );
    const index = await buildHandoffIndex(tmpDir);
    expect(index.active.size).toBe(1);
    expect(index.archived.size).toBe(1);
    expect(index.byWorkItem.get("gh:owner/repo#42")?.length).toBe(2);
    expect(index.byBranch.get("feature/a")?.length).toBe(1);
    expect(index.byBranch.get("feature/b")?.length).toBe(1);
  });
});
