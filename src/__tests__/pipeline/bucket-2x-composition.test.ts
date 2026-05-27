// F3.4-F8 (D3 Cycle 10 Wave 2): cross-module integration coverage for the
// Bucket 2.x resumability + rollback + cost-telemetry trio.
//
// Decisions 24/27/29/30 frame checkpoint (resumability), snapshot (rollback),
// and costEstimator (cost telemetry) as ONE cohesive orchestrator-session
// experience. Each module previously shipped isolated unit tests only — no
// test drove a single orchestrator session id through all three at once, so
// the shared session-id namespace contract was unverified. This test simulates
// one session end-to-end against a real temp project root and asserts the three
// on-disk artifacts —
//   .hatch3r/snapshots/<session>/meta.json
//   <workspace>/checkpoint.json   (e.g. .audit-workspace/checkpoint.json)
//   .hatch3r/telemetry/<session>.json
// — are mutually consistent on the session id, the project root, and carry
// parseable ISO timestamps.
//
// depends_on: F3.4-F2 (costEstimator now owns all cost computation; the
// telemetry helpers used here import from it).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSnapshot, sessionDir, SNAPSHOT_META_FILE } from "../../pipeline/snapshot.js";
import { writeCheckpoint, readCheckpoint, checkpointPath } from "../../pipeline/checkpoint.js";
import {
  estimateCost,
  recordActuals,
  TELEMETRY_DIR_RELATIVE,
} from "../../pipeline/costEstimator.js";

describe("Bucket 2.x composition: checkpoint × snapshot × costEstimator", () => {
  let projectRoot: string;
  // One session id threaded through all three modules.
  const sessionId = "bucket2x-session-2026-05-27";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "hatch3r-bucket2x-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("drives one session id through all three modules with mutually consistent artifacts", async () => {
    // ── Arrange: a touched file the orchestrator would snapshot pre-mutation ──
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    const touched = join(projectRoot, "src", "touched.ts");
    await writeFile(touched, "export const x = 1;\n", "utf-8");

    // ── 1. Snapshot module: capture pre-mutation state under the session ──
    const snap = await createSnapshot(sessionId, [touched], { projectRoot });
    expect(snap.count).toBe(1);
    const snapMetaPath = join(sessionDir(sessionId, projectRoot), SNAPSHOT_META_FILE);
    expect(existsSync(snapMetaPath)).toBe(true);
    const snapMeta = JSON.parse(await readFile(snapMetaPath, "utf-8"));

    // ── 2. Checkpoint module: record resumability state in the workspace ──
    const workspace = join(projectRoot, ".audit-workspace");
    const checkpointMeta = {
      baselineSha: "baseline-sha-7367d92",
      lastPassedGateN: 3,
      registrySha: "registry-sha-001",
      timestamp: new Date().toISOString(),
    };
    await writeCheckpoint(workspace, "wave-2", 2, "in-progress", checkpointMeta);
    expect(existsSync(checkpointPath(workspace))).toBe(true);
    const checkpoint = await readCheckpoint(workspace);

    // ── 3. Cost telemetry module: persist estimate + actuals for the session ──
    const estimate = estimateCost({ triageTier: "standard", subAgentDeclared: 8 });
    const ok = recordActuals(
      sessionId,
      {
        actual_sa_count: 8,
        actual_input_tokens_static_frame: estimate.estimated_input_tokens_static_frame,
        actual_web_research_queries: estimate.estimated_web_research_queries,
        actual_duration_min: estimate.estimated_duration_min,
        recorded_at: new Date().toISOString(),
      },
      { projectRoot, estimate, orchestrator: "hatch3r-audit-execute" },
    );
    expect(ok).toBe(true);
    const telemetryPath = join(projectRoot, TELEMETRY_DIR_RELATIVE, `${sessionId}.json`);
    expect(existsSync(telemetryPath)).toBe(true);
    const telemetry = JSON.parse(readFileSync(telemetryPath, "utf-8"));

    // ── Assert: session-id namespace is consistent across snapshot + telemetry ──
    expect(snapMeta.sessionId).toBe(sessionId);
    expect(telemetry.session_id).toBe(sessionId);
    // The snapshot session directory name IS the session id.
    expect(sessionDir(sessionId, projectRoot).endsWith(sessionId)).toBe(true);

    // ── Assert: all three artifacts are anchored to the same project root ──
    expect(snapMeta.projectRoot).toBe(projectRoot);
    expect(snapMetaPath.startsWith(projectRoot)).toBe(true);
    expect(checkpointPath(workspace).startsWith(projectRoot)).toBe(true);
    expect(telemetryPath.startsWith(projectRoot)).toBe(true);

    // ── Assert: every artifact carries a parseable ISO-8601 timestamp ──
    for (const ts of [snapMeta.timestamp, checkpoint!.meta.timestamp, telemetry.updated_at]) {
      expect(typeof ts).toBe("string");
      expect(Number.isNaN(Date.parse(ts))).toBe(false);
    }

    // ── Assert: pillar-impact attribution survives the round-trip ──
    // The telemetry delta is well-defined (estimate == actuals here → no flag).
    expect(telemetry.estimate.expected_sa_count).toBe(8);
    expect(telemetry.delta.over_variance).toBe(false);
    expect(telemetry.orchestrator).toBe("hatch3r-audit-execute");
    // The checkpoint phase/wave matches the wave the cost actuals were recorded in.
    expect(checkpoint!.phase).toBe("wave-2");
    expect(checkpoint!.wave).toBe(2);
  });

  it("a second session id writes disjoint artifacts (no namespace collision)", async () => {
    const sessionA = "bucket2x-A";
    const sessionB = "bucket2x-B";
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    const fileA = join(projectRoot, "src", "a.ts");
    const fileB = join(projectRoot, "src", "b.ts");
    await writeFile(fileA, "a\n", "utf-8");
    await writeFile(fileB, "b\n", "utf-8");

    await createSnapshot(sessionA, [fileA], { projectRoot });
    await createSnapshot(sessionB, [fileB], { projectRoot });
    recordActuals(
      sessionA,
      {
        actual_sa_count: 1,
        actual_input_tokens_static_frame: 1000,
        actual_web_research_queries: 0,
        actual_duration_min: 1,
        recorded_at: new Date().toISOString(),
      },
      { projectRoot },
    );

    // Session A and B snapshot dirs are distinct; only A has telemetry.
    expect(existsSync(join(sessionDir(sessionA, projectRoot), SNAPSHOT_META_FILE))).toBe(true);
    expect(existsSync(join(sessionDir(sessionB, projectRoot), SNAPSHOT_META_FILE))).toBe(true);
    expect(sessionDir(sessionA, projectRoot)).not.toBe(sessionDir(sessionB, projectRoot));
    expect(existsSync(join(projectRoot, TELEMETRY_DIR_RELATIVE, `${sessionA}.json`))).toBe(true);
    expect(existsSync(join(projectRoot, TELEMETRY_DIR_RELATIVE, `${sessionB}.json`))).toBe(false);
  });
});
