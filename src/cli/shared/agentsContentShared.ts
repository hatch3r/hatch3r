/**
 * DD-D3 (release/2.8.5): re-export shim. The shared filesystem readers
 * moved to `src/adapters/shared/agentsContentShared.ts` alongside the
 * bridge-orchestration builder that consumes them (import-boundary Rule 1 —
 * a domain module must not import `src/cli/**`). This shim keeps the
 * historical import path compiling (`agentsMdGenerator.ts`, tests) for one
 * minor release; new imports use the adapters/shared path.
 */
export {
  recordAgentsContentProbeFailure,
  type DirFile,
  readDirFiles,
  extractSkillChecklist,
  readSkillDirs,
} from "../../adapters/shared/agentsContentShared.js";
