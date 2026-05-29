import { describe, it, expect } from "vitest";
import * as agentsContent from "../../cli/shared/agentsContent.js";

// D1-SA1.7-F9 (Cycle 10 Wave 4): agentsContent.ts was decomposed into
// per-concern modules (taskRouter.ts, bridgeOrchestration.ts,
// agentsMdGenerator.ts, agentsContentShared.ts). The behavioral cases moved
// to taskRouter.test.ts and bridgeOrchestration.test.ts. agentsContent.ts is
// now a re-export barrel preserving the public import surface for existing
// importers (src/adapters/base.ts) and the `vi.mock("agentsContent.js")` in
// config.test.ts. This test pins that surface so an accidental drop of a
// re-export — which would break those consumers — fails loudly here.

describe("agentsContent barrel re-export surface", () => {
  it("re-exports every public symbol from the concern modules", () => {
    // Bridge orchestration.
    expect(typeof agentsContent.generateBridgeOrchestration).toBe("function");
    expect(typeof agentsContent.BRIDGE_ORCHESTRATION).toBe("string");
    expect(agentsContent.BRIDGE_ORCHESTRATION).toContain("Sub-Agent Pipeline");

    // Task router.
    expect(typeof agentsContent.buildTaskRouterModel).toBe("function");
    expect(typeof agentsContent.bestTaskTypeForSkill).toBe("function");

    // AGENTS.md generators.
    expect(typeof agentsContent.generateRootAgentsMd).toBe("function");
    expect(typeof agentsContent.generateCanonicalAgentsMd).toBe("function");
    expect(typeof agentsContent.AGENTS_MD_INNER).toBe("string");
    expect(typeof agentsContent.AGENTS_MD_FULL).toBe("string");
    // AGENTS_MD_FULL wraps AGENTS_MD_INNER in a managed block.
    expect(agentsContent.AGENTS_MD_FULL).toContain(agentsContent.AGENTS_MD_INNER);
  });
});
