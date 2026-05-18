import { describe, expect, it } from "vitest";
import {
  MAX_CONSENSUS_MESSAGES,
  fromConsensusPayload,
  toConsensusPayload,
  type ConsensusHandoffPayload,
} from "../../../content/handoffs/payloadAdapter.js";
import {
  REQUIRED_BODY_SECTIONS,
  computeHandoffIntegrity,
} from "../../../content/handoffs/validation.js";
import type { Handoff } from "../../../content/handoffs/schema.js";

function buildSampleBody(): string {
  return [
    "## Problem",
    "",
    "Cache invalidation drops stale keys late.",
    "",
    "## Decisions",
    "",
    "- Use LRU with TTL",
    "- Replicate writes through both nodes",
    "",
    "## Work Done",
    "",
    "- Wired up the LRU cache module",
    "- Added unit tests for the eviction path",
    "",
    "## Work Remaining",
    "",
    "- Integration tests against the live cluster",
    "",
    "## Blockers",
    "",
    "- Awaiting infra credentials",
    "",
    "## Next Steps",
    "",
    "- Resume after creds land",
    "",
    "## Build & Test Status",
    "",
    "- npm test green locally",
    "",
    "## File Manifest",
    "",
    "- src/cache/lru.ts",
    "",
  ].join("\n");
}

function buildHandoff(): Handoff {
  const body = buildSampleBody();
  return {
    frontmatter: {
      id: "2026-05-17_T1430_a3f2c_cache-refactor",
      type: "handoff",
      created: "2026-05-17T14:30:00.000Z",
      updated: "2026-05-17T14:30:00.000Z",
      status: "in-progress",
      source_agent: "hatch3r-implementer",
      target_agent: "hatch3r-reviewer",
      git_ref: "feature/cache@a1b2c3d",
      branch: "feature/cache",
      confidence: 0.8,
      completeness: 0.6,
      integrity: computeHandoffIntegrity(body),
      summary: "LRU cache refactor in progress",
      requirements: ["needs infra creds"],
    },
    body,
    filePath: "test.md",
  };
}

describe("payloadAdapter.toConsensusPayload", () => {
  it("parses required body sections into state fields", () => {
    const p = toConsensusPayload(buildHandoff());
    expect(p.state.problem).toContain("Cache invalidation");
    expect(p.state.decisions).toEqual(["Use LRU with TTL", "Replicate writes through both nodes"]);
    expect(p.state.work_done).toEqual([
      "Wired up the LRU cache module",
      "Added unit tests for the eviction path",
    ]);
    expect(p.state.work_remaining).toEqual(["Integration tests against the live cluster"]);
    expect(p.state.blockers).toEqual(["Awaiting infra credentials"]);
    expect(p.state.next_steps).toEqual(["Resume after creds land"]);
  });

  it("maps metadata fields 1:1 from frontmatter", () => {
    const h = buildHandoff();
    const p = toConsensusPayload(h);
    expect(p.metadata).toMatchObject({
      source_agent: h.frontmatter.source_agent,
      target_agent: h.frontmatter.target_agent,
      confidence: h.frontmatter.confidence,
      completeness: h.frontmatter.completeness,
      git_ref: h.frontmatter.git_ref,
      timestamp: h.frontmatter.updated,
      summary: h.frontmatter.summary,
    });
    expect(p.metadata.requirements).toEqual(h.frontmatter.requirements);
  });

  it("returns empty messages[] when no Compact Message Trail section", () => {
    const p = toConsensusPayload(buildHandoff());
    expect(p.messages).toEqual([]);
  });

  it("truncates messages[] to MAX_CONSENSUS_MESSAGES", () => {
    const trailLines: string[] = [];
    for (let i = 0; i < MAX_CONSENSUS_MESSAGES + 5; i++) {
      trailLines.push(`- user: message ${i}`);
    }
    const body = buildSampleBody() + "\n## Compact Message Trail\n\n" + trailLines.join("\n") + "\n";
    const h: Handoff = {
      frontmatter: { ...buildHandoff().frontmatter, integrity: computeHandoffIntegrity(body) },
      body,
      filePath: "test.md",
    };
    const p = toConsensusPayload(h);
    expect(p.messages.length).toBe(MAX_CONSENSUS_MESSAGES);
    expect(p.messages[0]).toEqual({ role: "user", content: "message 0" });
  });
});

describe("payloadAdapter.fromConsensusPayload", () => {
  it("synthesizes a body with all 8 required section headings", () => {
    const payload: ConsensusHandoffPayload = {
      messages: [],
      state: {
        problem: "Cache invalidation drops stale keys late.",
        decisions: ["LRU with TTL"],
        work_done: ["module wired"],
        work_remaining: ["integration tests"],
        blockers: ["infra creds"],
        next_steps: ["resume after creds"],
      },
      metadata: {
        source_agent: "hatch3r-implementer",
        target_agent: "hatch3r-reviewer",
        confidence: 0.8,
        completeness: 0.6,
        git_ref: "feature/cache@a1b2c3d",
        timestamp: "2026-05-17T14:30:00.000Z",
      },
    };
    const h = fromConsensusPayload(payload, {
      id: "2026-05-17_T1430_a3f2c_cache-refactor",
      status: "in-progress",
      branch: "feature/cache",
      integrity: "sha256:" + "0".repeat(64),
    });
    for (const heading of REQUIRED_BODY_SECTIONS) {
      expect(h.body).toContain(`## ${heading}`);
    }
  });

  it("wraps the synthesized body in user-tier markers", () => {
    const payload: ConsensusHandoffPayload = {
      messages: [],
      state: {
        problem: "x",
        decisions: [],
        work_done: [],
        work_remaining: [],
        blockers: [],
        next_steps: [],
      },
      metadata: {
        source_agent: "a",
        target_agent: "b",
        confidence: 0.5,
        completeness: 0.5,
        git_ref: "main@abcdef0",
        timestamp: "2026-05-17T14:30:00.000Z",
      },
    };
    const h = fromConsensusPayload(payload, {
      id: "2026-05-17_T1430_a3f2c_synthesized",
      status: "open",
      branch: "main",
      integrity: "sha256:" + "0".repeat(64),
    });
    expect(h.body).toContain("--- BEGIN USER-TIER CONTENT: handoff ---");
    expect(h.body).toContain("--- END USER-TIER CONTENT: handoff ---");
  });

  it("computes the integrity from the synthesized body", () => {
    const payload: ConsensusHandoffPayload = {
      messages: [],
      state: {
        problem: "p",
        decisions: ["d"],
        work_done: ["w"],
        work_remaining: ["r"],
        blockers: ["b"],
        next_steps: ["n"],
      },
      metadata: {
        source_agent: "a",
        target_agent: "b",
        confidence: 1,
        completeness: 1,
        git_ref: "main@abcdef0",
        timestamp: "2026-05-17T14:30:00.000Z",
      },
    };
    const h = fromConsensusPayload(payload, {
      id: "2026-05-17_T1430_a3f2c_rt",
      status: "open",
      branch: "main",
      integrity: "sha256:" + "0".repeat(64),
    });
    expect(h.frontmatter.integrity).toBe(computeHandoffIntegrity(h.body));
  });
});

describe("payloadAdapter round-trip", () => {
  it("preserves structural content through handoff -> consensus -> handoff", () => {
    const original = buildHandoff();
    const payload = toConsensusPayload(original);
    const reconstructed = fromConsensusPayload(payload, {
      id: original.frontmatter.id,
      status: original.frontmatter.status,
      branch: original.frontmatter.branch,
      integrity: original.frontmatter.integrity,
    });
    const roundTripPayload = toConsensusPayload(reconstructed);
    expect(roundTripPayload.state).toEqual(payload.state);
    expect(roundTripPayload.metadata.source_agent).toBe(payload.metadata.source_agent);
    expect(roundTripPayload.metadata.target_agent).toBe(payload.metadata.target_agent);
    expect(roundTripPayload.metadata.confidence).toBe(payload.metadata.confidence);
    expect(roundTripPayload.metadata.completeness).toBe(payload.metadata.completeness);
    expect(roundTripPayload.metadata.git_ref).toBe(payload.metadata.git_ref);
  });
});
