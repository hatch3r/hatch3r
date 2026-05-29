/**
 * D1-SA1.7-F9 (Cycle 10 Wave 4, D1 / CQ8 Maintainability): this module was a
 * single 839-line file that conflated four responsibilities — bridge text
 * builder, task-router model, root AGENTS.md generator, and canonical
 * AGENTS.md generator. It is now a thin re-export barrel over three
 * single-purpose modules (each independently testable, each <300 lines) plus
 * a shared filesystem-reader module:
 *
 *   - `./bridgeOrchestration.ts` — BridgeAdapter, BRIDGE_ORCHESTRATION,
 *     generateBridgeOrchestration (+ private buildBridgeOrchestration,
 *     BRIDGE_ADAPTER_PATHS, render helpers).
 *   - `./taskRouter.ts` — TaskRouterRow, TaskRouterPrimaryKind,
 *     buildTaskRouterModel, bestTaskTypeForSkill (+ private ranking helpers,
 *     WORKFLOW_TAGS/DOMAIN_TAGS facets, humanizeTaskType).
 *   - `./agentsMdGenerator.ts` — AGENTS_MD_INNER, AGENTS_MD_FULL,
 *     generateRootAgentsMd, generateCanonicalAgentsMd.
 *   - `./agentsContentShared.ts` — readDirFiles, readSkillDirs,
 *     extractSkillChecklist, recordAgentsContentProbeFailure (shared by the
 *     bridge and AGENTS.md generators).
 *
 * The barrel preserves the public import surface so existing importers
 * (`src/adapters/base.ts`) and tests (`src/__tests__/cli/agentsContent.test.ts`,
 * the `vi.mock("agentsContent.js")` in `config.test.ts`) keep resolving the
 * same names. No behavior change — function bodies were moved verbatim.
 */

export {
  type BridgeAdapter,
  BRIDGE_ORCHESTRATION,
  generateBridgeOrchestration,
} from "./bridgeOrchestration.js";

export {
  type TaskRouterPrimaryKind,
  type TaskRouterRow,
  buildTaskRouterModel,
  bestTaskTypeForSkill,
} from "./taskRouter.js";

export {
  AGENTS_MD_INNER,
  AGENTS_MD_FULL,
  generateRootAgentsMd,
  generateCanonicalAgentsMd,
} from "./agentsMdGenerator.js";
