/**
 * DD-D3 (release/2.8.5): re-export shim. The task-router model moved to
 * `src/adapters/shared/taskRouter.ts` alongside the bridge-orchestration
 * builder that consumes it (import-boundary Rule 1 — a domain module must
 * not import `src/cli/**`). This shim keeps the historical import path
 * compiling for one minor release; new imports use the adapters/shared path.
 */
export {
  DOMAIN_TAGS,
  type TaskRouterPrimaryKind,
  type TaskRouterRow,
  humanizeTaskType,
  buildTaskRouterModel,
  bestTaskTypeForSkill,
} from "../../adapters/shared/taskRouter.js";
