/**
 * DD-D3 (release/2.8.5): re-export shim. The bridge-orchestration builder
 * moved to `src/adapters/shared/bridgeOrchestration.ts` — its only
 * production consumer is `src/adapters/base.ts`, and a domain module
 * importing `src/cli/**` violated import-boundary Rule 1 (enforced by the
 * `no-restricted-imports` config in eslint.config.js and
 * `src/__tests__/architecture/importBoundaries.test.ts`). This shim keeps
 * the historical `src/cli/shared/` import path compiling (tests, the
 * `agentsContent.ts` barrel) for one minor release; new imports use the
 * adapters/shared path.
 */
export {
  type BridgeAdapter,
  BRIDGE_ORCHESTRATION,
  generateBridgeOrchestration,
} from "../../adapters/shared/bridgeOrchestration.js";
