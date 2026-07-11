import { access, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_MATURITY_TIER,
  HATCH3R_DIR,
  HatchError,
  MANIFEST_FILE,
  MATURITY_TIER_RANK,
  VALID_CONFIDENCE_FLOORS,
  VALID_MATURITY_TIERS,
  VALID_TEAMMATE_MODES,
  VALID_TOOLS,
  WORKTREE_CAPABLE_TOOLS,
  DEFAULT_FEATURES,
  type BoardConfig,
  type ClaudeConfig,
  type CliToolsConfig,
  type ConfidenceFloor,
  type ContentSelection,
  type ConventionConflict,
  type CostTrackingConfig,
  type CustomizationManifest,
  type HatchManifest,
  type HooksConfig,
  type MaturityTier,
  type ModelConfig,
  type PackageEntry,
  type Platform,
  type RepoEntry,
  type Tool,
} from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { atomicWriteFile } from "../merge/safeWrite.js";

/**
 * Validate a git branch name against the rules from `git check-ref-format`.
 *
 * Rejects names that:
 * - are empty or whitespace-only
 * - contain `..", `~`, `^`, `:`, `\`, spaces, or control characters
 * - start or end with `/` or `.`
 * - contain consecutive slashes `//`
 * - end with `.lock`
 * - contain `@{` (reflog syntax)
 * - are exactly `@`
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.trim() !== name) return false;
  if (/[~^:\\\x00-\x1f\x7f ]/.test(name)) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  if (name.startsWith(".") || name.endsWith(".")) return false;
  if (name.includes("..")) return false;
  if (name.includes("//")) return false;
  if (name.endsWith(".lock")) return false;
  if (name.includes("@{")) return false;
  if (name === "@") return false;
  return true;
}

function createMinimalBoardConfig(owner: string, repo: string, defaultBranch: string): BoardConfig {
  return {
    owner,
    repo,
    defaultBranch,
    projectNumber: null,
    statusFieldId: null,
    statusOptions: {
      backlog: null,
      ready: null,
      inProgress: null,
      inReview: null,
      done: null,
    },
    labels: {
      types: ["type:bug", "type:feature", "type:refactor", "type:qa", "type:docs", "type:infra"],
      executors: ["executor:agent", "executor:human", "executor:hybrid"],
      statuses: ["status:triage", "status:ready", "status:in-progress", "status:in-review", "status:blocked"],
      meta: ["meta:board-overview"],
    },
    branchConvention: "{type}/{short-description}",
    areas: [],
  };
}

export function createManifest(options: {
  platform?: Platform;
  owner?: string;
  repo?: string;
  namespace?: string;
  project?: string;
  defaultBranch?: string;
  tools: Tool[];
  features?: Partial<HatchManifest["features"]>;
  mcpServers?: string[];
  content?: ContentSelection;
  languages?: string[];
  /**
   * D14-M7 (Cycle 11): detected package manager from `analyzeRepo`
   * (`RepoInfo.packageManager`). Persisted so `verificationGatesFromManifest`
   * can forward it to `resolveVerificationGates` at sync time and render
   * `pnpm run test` / `yarn test` / `bun run test` for non-npm JS projects.
   * Omitted when absent or `"unknown"` so npm projects and pre-Cycle-11
   * fixtures stay byte-identical.
   */
  packageManager?: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  /**
   * C9-H47 (D14-SA14.4-H01): detected toolchain results from
   * `analyzeRepo`. Persisted on the manifest so adapter sync — which does
   * not re-run `analyzeRepo` — can resolve `${HATCH3R:LINTER}` etc.
   * tokens from the manifest alone. Omitted from the written manifest
   * when every field is empty so older fixtures stay byte-identical.
   */
  detected?: {
    linters?: string[];
    testFrameworks?: string[];
    ciProviders?: string[];
  };
  worktreeEnabled?: boolean;
  customization?: CustomizationManifest;
  /**
   * CLI-tooling pivot (1.7.5 / plan §4.2). When omitted the manifest is
   * left without a `cliTools` field — pre-1.7.5 manifest shape. When
   * supplied the field is written verbatim and consumers should read it
   * via {@link readCliToolsConfig} so absence still maps to
   * `{enabled: false, selected: []}`.
   */
  cliTools?: CliToolsConfig;
  /**
   * F14.2-H1 (D14): monorepo package layout enumerated by
   * `detectMonorepoPackages` at init time. Persisted on the manifest so
   * `hatch3r sync` knows which `<package>/.hatch3r/` targets to refresh
   * without re-running repo detection. Absence collapses to "no packages"
   * — sync behaves as a single-package repo. Empty array is treated the
   * same as absence (preserves manifest byte-identity for non-monorepo
   * repos).
   */
  packages?: PackageEntry[];
  /**
   * D14-13 (D14-SA14.4-F3, P1/P4): mutually-exclusive convention conflicts
   * detected from the toolchain lists at init time (e.g. both `vitest` and
   * `jest`). Persisted so `status`/`verify` can re-surface that generated
   * single-toolchain guidance may contradict a second config. Empty/absent
   * writes no field (preserves manifest byte-identity for unambiguous repos).
   */
  conflicts?: ConventionConflict[];
}): HatchManifest {
  const platform = options.platform ?? "github";
  const owner = options.owner ?? "";
  const repo = options.repo ?? "";
  const namespace = options.namespace ?? owner;
  const project = options.project ?? repo;
  const manifest: HatchManifest = {
    // schemaVersion 3 (Wave 6): manifest moved from `.agents/hatch.json` to
    // `.hatch3r/hatch.json`, root AGENTS.md bridge removed, and
    // `managedFilesByAdapter._shared` dropped (the sentinel bucket that
    // tracked the legacy root-AGENTS.md bridge — no shared bridge files
    // remain after Wave 3 removed AGENTS.md emission).
    version: "3.0.0",
    hatch3rVersion: HATCH3R_VERSION,
    platform,
    owner,
    repo,
    namespace,
    project,
    tools: options.tools,
    features: {
      ...DEFAULT_FEATURES,
      ...options.features,
      // W3-mcp-optin hardening: when the caller does not set `features.mcp`
      // explicitly, derive it from the resolved server list so a manifest can
      // never carry `mcp.servers` entries while reporting the feature off.
      // An explicit `features.mcp` (true or false) wins over the derivation.
      mcp: options.features?.mcp ?? ((options.mcpServers?.length ?? 0) > 0),
    },
    mcp: { servers: options.mcpServers ?? [] },
    managedFiles: [],
  };
  if (options.content) {
    manifest.content = options.content;
  }
  if (options.customization) {
    manifest.customization = options.customization;
  }
  if (options.cliTools) {
    manifest.cliTools = options.cliTools;
  }
  // F14.2-H1 (D14): persist the package layout so sync.ts can fan adapter
  // output into each `<package>/.hatch3r/` without re-running `analyzeRepo`.
  // Empty/absent collapses to single-package emission (no field written).
  if (options.packages && options.packages.length > 0) {
    manifest.packages = options.packages;
  }
  if (options.languages && options.languages.length > 0 && options.languages[0] !== "unknown") {
    manifest.languages = options.languages;
  }
  // D14-M7 (Cycle 11): persist the detected package manager so sync-time
  // gate resolution renders the project's native run command. Omit `"unknown"`
  // and absence so the written manifest stays byte-identical for npm projects
  // (npm is the resolver default) and pre-Cycle-11 fixtures.
  if (options.packageManager && options.packageManager !== "unknown") {
    manifest.packageManager = options.packageManager;
  }
  // C9-H47: persist detection results when at least one axis has content.
  // Empty arrays collapse to omission so the written manifest stays
  // byte-identical to pre-1.8.0 fixtures when detection found nothing
  // useful — the substitution layer treats absence as "unknown".
  if (options.detected) {
    const linters = options.detected.linters?.filter(Boolean) ?? [];
    const testFrameworks = options.detected.testFrameworks?.filter(Boolean) ?? [];
    const ciProviders = options.detected.ciProviders?.filter(Boolean) ?? [];
    if (linters.length > 0 || testFrameworks.length > 0 || ciProviders.length > 0) {
      manifest.detected = {};
      if (linters.length > 0) manifest.detected.linters = linters;
      if (testFrameworks.length > 0) manifest.detected.testFrameworks = testFrameworks;
      if (ciProviders.length > 0) manifest.detected.ciProviders = ciProviders;
    }
  }
  // D14-13 (D14-SA14.4-F3): persist convention conflicts when any were
  // detected. Empty/absent collapses to omission so the written manifest
  // stays byte-identical for repos with unambiguous toolchains.
  if (options.conflicts && options.conflicts.length > 0) {
    manifest.conflicts = options.conflicts;
  }
  if (options.defaultBranch) {
    manifest.board = createMinimalBoardConfig(owner, repo, options.defaultBranch);
  }
  const autoEnable = options.tools.some(t => WORKTREE_CAPABLE_TOOLS.has(t));
  const shouldEnable = options.worktreeEnabled ?? autoEnable;
  if (shouldEnable) {
    manifest.worktree = { enabled: true };
  }
  return manifest;
}

/**
 * D1-M14 (Cycle 10 Wave-3 Medium): declarative manifest-migration registry.
 *
 * Previously migrateManifest was an ad-hoc spread of inline mutations: it
 * was difficult to read which version-bumps and field-renames had landed,
 * impossible to test individual steps, and easy to introduce ordering
 * regressions when the next migration arrived. Refactored to a single
 * registry of {id, description, apply} so each migration is independently
 * inspectable and unit-testable, and operators can list executed migrations
 * via the exported `MANIFEST_MIGRATIONS` table.
 *
 * Apply order: declaration order. Each migration receives the manifest
 * mutated by every earlier migration. Migrations are idempotent — running
 * the registry twice on the same input MUST produce the same output.
 */
export interface ManifestMigration {
  /** Stable identifier (used in logs and tests). */
  id: string;
  /** Human-readable summary of what this migration does. */
  description: string;
  /** Apply step. Mutates the manifest in place; returns the same reference. */
  apply: (m: Record<string, unknown>) => void;
}

export const MANIFEST_MIGRATIONS: readonly ManifestMigration[] = [
  {
    id: "namespace-from-owner",
    description: "Default namespace to owner when missing (platform-neutral identity).",
    apply(m) {
      if (!m.namespace && typeof m.owner === "string") m.namespace = m.owner;
      if (!m.namespace) m.namespace = "";
    },
  },
  {
    id: "project-from-repo",
    description: "Default project to repo when missing (platform-neutral identity).",
    apply(m) {
      if (!m.project && typeof m.repo === "string") m.project = m.repo;
      if (!m.project) m.project = "";
    },
  },
  {
    id: "v1-to-v2",
    description: "Bump manifest version 1.0.0 -> 2.0.0.",
    apply(m) {
      if (m.version === "1.0.0") m.version = "2.0.0";
    },
  },
  {
    id: "drop-agents-md-tool",
    description: "1.7.0: agents-md is no longer a selectable tool; remove it from tools[].",
    apply(m) {
      if (Array.isArray(m.tools)) {
        m.tools = (m.tools as unknown[]).filter(
          (t) => typeof t !== "string" || t !== "agents-md",
        );
      }
    },
  },
  {
    id: "drop-shared-sentinel",
    description: "Wave 6 (1.9.0): drop the _shared sentinel bucket from managedFilesByAdapter (legacy root-AGENTS.md bridge).",
    apply(m) {
      if (m.managedFilesByAdapter !== null && typeof m.managedFilesByAdapter === "object") {
        const mfba = m.managedFilesByAdapter as Record<string, unknown>;
        if ("_shared" in mfba) {
          delete mfba._shared;
        }
      }
    },
  },
  {
    id: "v2-to-v3",
    description: "Bump manifest version 2.0.0 -> 3.0.0.",
    apply(m) {
      if (m.version === "2.0.0") m.version = "3.0.0";
    },
  },
];

export function migrateManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...raw };
  for (const migration of MANIFEST_MIGRATIONS) {
    migration.apply(migrated);
  }
  return migrated;
}

/**
 * D1-M13 (Cycle 10 Wave-3 Medium): per-field manifest validator.
 *
 * Earlier implementations returned `false` on first malformed field, so
 * callers got "required fields missing or malformed" with no clue which
 * field was at fault. This helper threads a string[] accumulator through
 * every check so the boolean wrapper below can format a single error
 * message naming every field that failed schema. The boolean wrapper
 * preserves the existing `data is HatchManifest` type-guard contract.
 */
/**
 * D1-SA1.6-F5 (Low, CQ8): shared validator for an optional string field that
 * must belong to a fixed value set (a "string union" in the TypeScript type).
 * Pushes a single error naming the field and the offending value when present
 * and out of set. Centralising this keeps the per-field membership checks in
 * {@link collectManifestErrors} from being copy-pasted as new union fields are
 * added (the larger zod migration is deferred post-2.0 per the same finding).
 * `undefined` is treated as "absent → valid" so optional fields stay optional.
 */
function validateStringUnion(
  value: unknown,
  validValues: ReadonlySet<string>,
  fieldName: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !validValues.has(value)) {
    errors.push(`\`${fieldName}\` is not a known value (got ${JSON.stringify(value)})`);
  }
}

function collectManifestErrors(data: unknown): string[] {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("manifest is not an object");
    return errors;
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== "string") errors.push("`version` is missing or not a string");
  if (typeof obj.hatch3rVersion !== "string") errors.push("`hatch3rVersion` is missing or not a string");
  if (obj.platform !== undefined && typeof obj.platform !== "string") errors.push("`platform` is not a string");
  if (!Array.isArray(obj.tools)) errors.push("`tools` is missing or not an array");
  if (obj.features === null || typeof obj.features !== "object" || Array.isArray(obj.features)) {
    errors.push("`features` is missing or not an object");
  }
  if (obj.mcp === null || typeof obj.mcp !== "object" || Array.isArray(obj.mcp)) {
    errors.push("`mcp` is missing or not an object");
  }
  if (!Array.isArray(obj.managedFiles)) errors.push("`managedFiles` is missing or not an array");

  // F3.3-C1: Validate `mcp.servers` sub-schema — required, must be string[].
  if (obj.mcp && typeof obj.mcp === "object" && !Array.isArray(obj.mcp)) {
    const mcp = obj.mcp as Record<string, unknown>;
    if (!Array.isArray(mcp.servers)) {
      errors.push("`mcp.servers` is missing or not an array");
    } else if (!(mcp.servers as unknown[]).every((s) => typeof s === "string")) {
      errors.push("`mcp.servers` contains non-string entries");
    }
  }

  // #108: Validate tools array entries are known tool strings
  if (Array.isArray(obj.tools)) {
    for (const tool of obj.tools as unknown[]) {
      if (typeof tool !== "string" || !VALID_TOOLS.has(tool)) {
        errors.push(`\`tools\` contains unknown entry ${JSON.stringify(tool)}`);
      }
    }
  }

  // F1.2-H2: validate optional `maturity` scalar at the persistence boundary.
  // D1-SA1.6-F5: routed through the shared validateStringUnion helper so the
  // membership-check pattern is reused (not copy-pasted) by future union fields.
  validateStringUnion(obj.maturity, VALID_MATURITY_TIERS, "maturity", errors);

  // D13-SA13.3-F13.3.3: validate the optional `confidenceFloor` scalar at the
  // persistence boundary via the same shared helper, so an out-of-enum value
  // hand-edited into hatch.json is rejected on read rather than silently
  // mis-driving the orchestrator assertiveness gate.
  validateStringUnion(obj.confidenceFloor, VALID_CONFIDENCE_FLOORS, "confidenceFloor", errors);

  // #108: board sub-schema
  if (obj.board !== undefined) {
    if (typeof obj.board !== "object" || obj.board === null) {
      errors.push("`board` is not an object");
    } else {
      const board = obj.board as Record<string, unknown>;
      if (typeof board.owner !== "string") errors.push("`board.owner` is not a string");
      if (typeof board.repo !== "string") errors.push("`board.repo` is not a string");
      if (board.defaultBranch !== undefined) {
        if (typeof board.defaultBranch !== "string") {
          errors.push("`board.defaultBranch` is not a string");
        } else if (!isValidGitBranchName(board.defaultBranch)) {
          errors.push(`\`board.defaultBranch\` (${JSON.stringify(board.defaultBranch)}) is not a valid git branch name`);
        }
      }
    }
  }

  // #108: worktree.extraPatterns
  if (obj.worktree !== undefined) {
    const wt = obj.worktree as Record<string, unknown>;
    if (wt.extraPatterns !== undefined) {
      if (!Array.isArray(wt.extraPatterns)) {
        errors.push("`worktree.extraPatterns` is not an array");
      } else if (!(wt.extraPatterns as unknown[]).every((v) => typeof v === "string")) {
        errors.push("`worktree.extraPatterns` contains non-string entries");
      }
    }
  }

  if (obj.content !== undefined) {
    if (typeof obj.content !== "object" || obj.content === null) {
      errors.push("`content` is not an object");
    } else {
      const content = obj.content as Record<string, unknown>;
      if (typeof content.preset !== "string") errors.push("`content.preset` is not a string");
      if (typeof content.projectType !== "string") errors.push("`content.projectType` is not a string");
      if (typeof content.teamSize !== "string") errors.push("`content.teamSize` is not a string");
      if (!content.items || typeof content.items !== "object") {
        errors.push("`content.items` is missing or not an object");
      } else {
        const items = content.items as Record<string, unknown>;
        const requiredKeys = ["agents", "skills", "rules", "commands", "prompts", "hooks", "githubAgents"];
        for (const key of requiredKeys) {
          if (!Array.isArray(items[key])) {
            errors.push(`\`content.items.${key}\` is missing or not an array`);
          } else if (!(items[key] as unknown[]).every((v) => typeof v === "string")) {
            errors.push(`\`content.items.${key}\` contains non-string entries`);
          }
        }
      }
    }
  }

  if (obj.costTracking !== undefined) {
    if (typeof obj.costTracking !== "object" || obj.costTracking === null) {
      errors.push("`costTracking` is not an object");
    } else {
      const ct = obj.costTracking as Record<string, unknown>;
      if (ct.sessionBudget !== undefined && typeof ct.sessionBudget !== "number") errors.push("`costTracking.sessionBudget` is not a number");
      if (ct.issueBudget !== undefined && typeof ct.issueBudget !== "number") errors.push("`costTracking.issueBudget` is not a number");
      if (ct.epicBudget !== undefined && typeof ct.epicBudget !== "number") errors.push("`costTracking.epicBudget` is not a number");
      if (ct.currency !== undefined && typeof ct.currency !== "string") errors.push("`costTracking.currency` is not a string");
      if (ct.warningThresholds !== undefined) {
        if (!Array.isArray(ct.warningThresholds)) {
          errors.push("`costTracking.warningThresholds` is not an array");
        } else if (!(ct.warningThresholds as unknown[]).every((v) => typeof v === "number")) {
          errors.push("`costTracking.warningThresholds` contains non-number entries");
        }
      }
      if (ct.hardStop !== undefined && typeof ct.hardStop !== "boolean") errors.push("`costTracking.hardStop` is not a boolean");
    }
  }

  if (obj.customization !== undefined) {
    if (typeof obj.customization !== "object" || obj.customization === null) {
      errors.push("`customization` is not an object");
    } else {
      const cu = obj.customization as Record<string, unknown>;
      if (cu.schemaVersion !== 1) errors.push(`\`customization.schemaVersion\` is not 1 (got ${JSON.stringify(cu.schemaVersion)})`);
      const perTypeKeys = ["agents", "skills", "rules", "commands"] as const;
      for (const key of perTypeKeys) {
        const v = cu[key];
        if (v === undefined) continue;
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          errors.push(`\`customization.${key}\` is not an object`);
        } else {
          for (const inner of Object.values(v as Record<string, unknown>)) {
            if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
              errors.push(`\`customization.${key}.*\` entry is not an object`);
              break;
            }
          }
        }
      }
      if (cu.integrations !== undefined) {
        if (typeof cu.integrations !== "object" || cu.integrations === null || Array.isArray(cu.integrations)) {
          errors.push("`customization.integrations` is not an object");
        }
      }
    }
  }

  if (obj.specs !== undefined) {
    if (typeof obj.specs !== "object" || obj.specs === null) {
      errors.push("`specs` is not an object");
    } else {
      const specs = obj.specs as Record<string, unknown>;
      if (!Array.isArray(specs.paths)) {
        errors.push("`specs.paths` is not an array");
      } else if (!(specs.paths as unknown[]).every((v) => typeof v === "string")) {
        errors.push("`specs.paths` contains non-string entries");
      }
      if (specs.lastGenerated !== undefined && typeof specs.lastGenerated !== "string") errors.push("`specs.lastGenerated` is not a string");
    }
  }

  if (obj.workspace !== undefined) {
    if (typeof obj.workspace !== "object" || obj.workspace === null) {
      errors.push("`workspace` is not an object");
    } else {
      const ws = obj.workspace as Record<string, unknown>;
      if (typeof ws.rootPath !== "string") errors.push("`workspace.rootPath` is not a string");
      if (typeof ws.lastSync !== "string") errors.push("`workspace.lastSync` is not a string");
      if (typeof ws.syncVersion !== "string") errors.push("`workspace.syncVersion` is not a string");
      if (typeof ws.workspaceChecksum !== "string") errors.push("`workspace.workspaceChecksum` is not a string");
      if (ws.excludedContent !== undefined) {
        if (!Array.isArray(ws.excludedContent)) {
          errors.push("`workspace.excludedContent` is not an array");
        } else if (!(ws.excludedContent as unknown[]).every((v) => typeof v === "string")) {
          errors.push("`workspace.excludedContent` contains non-string entries");
        }
      }
      if (ws.localContent !== undefined) {
        if (!Array.isArray(ws.localContent)) {
          errors.push("`workspace.localContent` is not an array");
        } else if (!(ws.localContent as unknown[]).every((v) => typeof v === "string")) {
          errors.push("`workspace.localContent` contains non-string entries");
        }
      }
    }
  }

  if (obj.managedFilesByAdapter !== undefined) {
    if (typeof obj.managedFilesByAdapter !== "object" || obj.managedFilesByAdapter === null) {
      errors.push("`managedFilesByAdapter` is not an object");
    } else {
      for (const [k, v] of Object.entries(obj.managedFilesByAdapter as Record<string, unknown>)) {
        if (typeof k !== "string") {
          errors.push("`managedFilesByAdapter` has a non-string key");
        } else if (!Array.isArray(v)) {
          errors.push(`\`managedFilesByAdapter.${k}\` is not an array`);
        } else if (!(v as unknown[]).every((p) => typeof p === "string")) {
          errors.push(`\`managedFilesByAdapter.${k}\` contains non-string entries`);
        }
      }
    }
  }

  // D14-M7 (Cycle 11): package manager (optional). A hand-edited manifest
  // with an out-of-enum value fails closed here rather than silently rendering
  // an npm command at sync time (the resolver only honors npm/yarn/pnpm/bun).
  if (obj.packageManager !== undefined) {
    const validPackageManagers = ["npm", "yarn", "pnpm", "bun", "unknown"];
    if (
      typeof obj.packageManager !== "string" ||
      !validPackageManagers.includes(obj.packageManager)
    ) {
      errors.push(
        `\`packageManager\` is not one of ${validPackageManagers.join(", ")}`,
      );
    }
  }

  // C9-H47: detected toolchain context (optional).
  if (obj.detected !== undefined) {
    if (typeof obj.detected !== "object" || obj.detected === null) {
      errors.push("`detected` is not an object");
    } else {
      const det = obj.detected as Record<string, unknown>;
      const detectionKeys = ["linters", "testFrameworks", "ciProviders"] as const;
      for (const key of detectionKeys) {
        const v = det[key];
        if (v === undefined) continue;
        if (!Array.isArray(v)) {
          errors.push(`\`detected.${key}\` is not an array`);
        } else if (!(v as unknown[]).every((s) => typeof s === "string")) {
          errors.push(`\`detected.${key}\` contains non-string entries`);
        }
      }
    }
  }

  // D14-13 (D14-SA14.4-F3): convention conflicts (optional). Each entry must
  // carry a string `dimension`, a `string[]` `tools`, and a string `message`
  // so a hand-edited manifest fails closed with HatchError rather than a
  // downstream TypeError when `status`/`verify` re-render the warning.
  if (obj.conflicts !== undefined) {
    if (!Array.isArray(obj.conflicts)) {
      errors.push("`conflicts` is not an array");
    } else {
      (obj.conflicts as unknown[]).forEach((c, i) => {
        if (typeof c !== "object" || c === null || Array.isArray(c)) {
          errors.push(`\`conflicts[${i}]\` is not an object`);
          return;
        }
        const conflict = c as Record<string, unknown>;
        if (typeof conflict.dimension !== "string") {
          errors.push(`\`conflicts[${i}].dimension\` is not a string`);
        }
        if (typeof conflict.message !== "string") {
          errors.push(`\`conflicts[${i}].message\` is not a string`);
        }
        if (!Array.isArray(conflict.tools)) {
          errors.push(`\`conflicts[${i}].tools\` is not an array`);
        } else if (!(conflict.tools as unknown[]).every((t) => typeof t === "string")) {
          errors.push(`\`conflicts[${i}].tools\` contains non-string entries`);
        }
      });
    }
  }

  // D20 user-content counters (optional).
  if (obj.userContent !== undefined) {
    if (typeof obj.userContent !== "object" || obj.userContent === null) {
      errors.push("`userContent` is not an object");
    } else {
      const uc = obj.userContent as Record<string, unknown>;
      if (typeof uc.count !== "number") errors.push("`userContent.count` is not a number");
      if (typeof uc.lastModified !== "string") errors.push("`userContent.lastModified` is not a string");
      if (typeof uc.types !== "object" || uc.types === null) {
        errors.push("`userContent.types` is not an object");
      } else {
        for (const [k, v] of Object.entries(uc.types as Record<string, unknown>)) {
          if (typeof k !== "string") {
            errors.push("`userContent.types` has a non-string key");
          } else if (typeof v !== "number") {
            errors.push(`\`userContent.types.${k}\` is not a number`);
          }
        }
      }
    }
  }

  // D1-23 (Cycle 11 Wave 3, D1, P2/P6): the eight remaining optional
  // HatchManifest fields below were unchecked, so a hand-edited
  // `models.agents.<id>=42` survived the persistence boundary and reached
  // `resolveAgentModel` (src/models/resolve.ts), which passes the raw value to
  // `resolveModelAlias` and stamps it into adapter output (cursor.ts:235). Each
  // check mirrors the field's `src/types.ts` shape so a malformed value fails
  // closed with a named-field diagnostic rather than corrupting generated
  // config. `models` mirrors `validateModels` (src/cli/commands/validate.ts).

  // versionConstraint (optional string — npm semver expression).
  if (obj.versionConstraint !== undefined && typeof obj.versionConstraint !== "string") {
    errors.push("`versionConstraint` is not a string");
  }

  // languages (optional string[]).
  if (obj.languages !== undefined) {
    if (!Array.isArray(obj.languages)) {
      errors.push("`languages` is not an array");
    } else if (!(obj.languages as unknown[]).every((v) => typeof v === "string")) {
      errors.push("`languages` contains non-string entries");
    }
  }

  // repos (optional RepoEntry[]: { owner: string; repo: string; name?: string }).
  if (obj.repos !== undefined) {
    if (!Array.isArray(obj.repos)) {
      errors.push("`repos` is not an array");
    } else {
      (obj.repos as unknown[]).forEach((r, i) => {
        if (typeof r !== "object" || r === null || Array.isArray(r)) {
          errors.push(`\`repos[${i}]\` is not an object`);
          return;
        }
        const repo = r as Record<string, unknown>;
        if (typeof repo.owner !== "string") errors.push(`\`repos[${i}].owner\` is not a string`);
        if (typeof repo.repo !== "string") errors.push(`\`repos[${i}].repo\` is not a string`);
        if (repo.name !== undefined && typeof repo.name !== "string") {
          errors.push(`\`repos[${i}].name\` is not a string`);
        }
      });
    }
  }

  // packages (optional PackageEntry[]: { name: string; path: string }).
  if (obj.packages !== undefined) {
    if (!Array.isArray(obj.packages)) {
      errors.push("`packages` is not an array");
    } else {
      (obj.packages as unknown[]).forEach((p, i) => {
        if (typeof p !== "object" || p === null || Array.isArray(p)) {
          errors.push(`\`packages[${i}]\` is not an object`);
          return;
        }
        const pkg = p as Record<string, unknown>;
        if (typeof pkg.name !== "string") errors.push(`\`packages[${i}].name\` is not a string`);
        if (typeof pkg.path !== "string") errors.push(`\`packages[${i}].path\` is not a string`);
      });
    }
  }

  // hooks (optional HooksConfig: { enabled: boolean }).
  if (obj.hooks !== undefined) {
    if (typeof obj.hooks !== "object" || obj.hooks === null || Array.isArray(obj.hooks)) {
      errors.push("`hooks` is not an object");
    } else if (typeof (obj.hooks as Record<string, unknown>).enabled !== "boolean") {
      errors.push("`hooks.enabled` is not a boolean");
    }
  }

  // models (optional ModelConfig: { default?: string; agents?/skills?/
  // commands?: Record<string,string> } — per-artifact maps extended to skills
  // and commands in release/2.2.0). Mirrors `validateModels` in
  // src/cli/commands/validate.ts so the value resolved by
  // `resolveAgentModel` / `resolveArtifactModel` is a string at every adapter
  // call site.
  if (obj.models !== undefined) {
    if (typeof obj.models !== "object" || obj.models === null || Array.isArray(obj.models)) {
      errors.push("`models` is not an object");
    } else {
      const models = obj.models as Record<string, unknown>;
      if (models.default !== undefined && typeof models.default !== "string") {
        errors.push("`models.default` is not a string");
      }
      for (const cls of ["agents", "skills", "commands"] as const) {
        const map = models[cls];
        if (map === undefined) continue;
        if (typeof map !== "object" || map === null || Array.isArray(map)) {
          errors.push(`\`models.${cls}\` is not an object`);
        } else {
          for (const [artifactId, model] of Object.entries(map as Record<string, unknown>)) {
            if (typeof model !== "string") {
              errors.push(`\`models.${cls}.${artifactId}\` is not a string`);
            }
          }
        }
      }
    }
  }

  // claude (optional ClaudeConfig). Validate the scalar/enum fields adapters
  // read; `permissions.{allow,deny}` must be string[] when present.
  if (obj.claude !== undefined) {
    if (typeof obj.claude !== "object" || obj.claude === null || Array.isArray(obj.claude)) {
      errors.push("`claude` is not an object");
    } else {
      const claude = obj.claude as Record<string, unknown>;
      if (claude.permissions !== undefined) {
        if (typeof claude.permissions !== "object" || claude.permissions === null || Array.isArray(claude.permissions)) {
          errors.push("`claude.permissions` is not an object");
        } else {
          const perms = claude.permissions as Record<string, unknown>;
          for (const key of ["allow", "deny"] as const) {
            const v = perms[key];
            if (v === undefined) continue;
            if (!Array.isArray(v)) {
              errors.push(`\`claude.permissions.${key}\` is not an array`);
            } else if (!(v as unknown[]).every((s) => typeof s === "string")) {
              errors.push(`\`claude.permissions.${key}\` contains non-string entries`);
            }
          }
        }
      }
      validateStringUnion(
        claude.teammateMode,
        VALID_TEAMMATE_MODES,
        "claude.teammateMode",
        errors,
      );
      if (
        claude.agentTeams !== undefined &&
        typeof claude.agentTeams !== "boolean" &&
        claude.agentTeams !== "ga"
      ) {
        errors.push("`claude.agentTeams` is not a boolean or \"ga\"");
      }
      // D9-12 (D9, P3): opt-in AGENTS.md interop flag — boolean only.
      if (claude.agentsMdInterop !== undefined && typeof claude.agentsMdInterop !== "boolean") {
        errors.push("`claude.agentsMdInterop` is not a boolean");
      }
    }
  }

  // cliTools (optional CliToolsConfig: { enabled: boolean; selected: string[];
  // overrides?: Record<string, { disabled?: boolean; note?: string }> }).
  if (obj.cliTools !== undefined) {
    if (typeof obj.cliTools !== "object" || obj.cliTools === null || Array.isArray(obj.cliTools)) {
      errors.push("`cliTools` is not an object");
    } else {
      const ct = obj.cliTools as Record<string, unknown>;
      if (typeof ct.enabled !== "boolean") errors.push("`cliTools.enabled` is not a boolean");
      if (!Array.isArray(ct.selected)) {
        errors.push("`cliTools.selected` is not an array");
      } else if (!(ct.selected as unknown[]).every((s) => typeof s === "string")) {
        errors.push("`cliTools.selected` contains non-string entries");
      }
      if (ct.overrides !== undefined) {
        if (typeof ct.overrides !== "object" || ct.overrides === null || Array.isArray(ct.overrides)) {
          errors.push("`cliTools.overrides` is not an object");
        } else {
          for (const [id, ov] of Object.entries(ct.overrides as Record<string, unknown>)) {
            if (typeof ov !== "object" || ov === null || Array.isArray(ov)) {
              errors.push(`\`cliTools.overrides.${id}\` is not an object`);
              continue;
            }
            const override = ov as Record<string, unknown>;
            if (override.disabled !== undefined && typeof override.disabled !== "boolean") {
              errors.push(`\`cliTools.overrides.${id}.disabled\` is not a boolean`);
            }
            if (override.note !== undefined && typeof override.note !== "string") {
              errors.push(`\`cliTools.overrides.${id}.note\` is not a string`);
            }
          }
        }
      }
    }
  }

  return errors;
}

function validateManifest(data: unknown): data is HatchManifest {
  return collectManifestErrors(data).length === 0;
}

/**
 * Wave 6 manifest-relocation shim. Migrates `.agents/hatch.json` ->
 * `.hatch3r/hatch.json` on first read against an existing pre-1.9 install.
 * Idempotent: returns immediately when the new path already holds the file,
 * and never touches `.agents/` when `.hatch3r/hatch.json` is present.
 *
 * Emits a single one-shot console warning per migration so operators see why
 * the directory changed; no warning when the layout is already current.
 *
 * Surrounding state moves (`learnings/`, `handoffs/`, `mcp/mcp.json`) are
 * handled by `src/migration/agentsToHatch3r.ts::migrateAgentsToHatch3r`,
 * which is called from `runInit`/`runSync`/`runUpdate`/`runRegenerate`/
 * `syncWorkspaceRepos`. The shim here is a defensive duplicate for callers
 * that exercise `readManifest` outside those entry points.
 */
async function migrateManifestPath(rootDir: string): Promise<void> {
  // Legacy `.agents/` literal — migration shim only; new writes target
  // `.hatch3r/`.
  const oldPath = join(rootDir, ".agents", MANIFEST_FILE);
  const newPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);
  // Fast path: new layout already in place.
  try {
    await access(newPath);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // Old path must exist for a migration to make sense.
  try {
    await access(oldPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await mkdir(join(rootDir, HATCH3R_DIR), { recursive: true });
  await rename(oldPath, newPath);
  console.warn(
    `[hatch3r] Migrated manifest from .agents/${MANIFEST_FILE} ` +
      `to ${HATCH3R_DIR}/${MANIFEST_FILE}.`,
  );
}

export async function readManifest(
  rootDir: string,
): Promise<HatchManifest | null> {
  await migrateManifestPath(rootDir);
  const manifestPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    // D8-SA8.1-01: pass `undefined` (not a hand-picked `1`) so CONFIG_ERROR
    // resolves through ERROR_CODE_TO_EXIT_CODE to sysexits EX_DATAERR (65),
    // matching writeManifest below and the missing-manifest path in the CLI
    // commands. Explicit exit codes stay reserved for 0 (cancel) / 2 (usage)
    // per the ERROR_CODE_TO_EXIT_CODE contract in src/types.ts.
    throw new HatchError(
      `Malformed JSON in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      "CONFIG_ERROR",
      `Fix the JSON syntax in ${manifestPath}, or delete the file and run \`hatch3r init\` to regenerate it. If you have version control, \`git checkout -- ${HATCH3R_DIR}/${MANIFEST_FILE}\` restores the last committed copy.`,
    );
  }

  const migrated = migrateManifest(parsed as Record<string, unknown>);

  // D1-M13: surface every malformed field in the diagnostic so users can
  // fix their hand-edited manifest in one pass instead of recovering field
  // by field across reruns. The type-guard wrapper narrows `migrated` to
  // HatchManifest so the cast is sound — fail-closed when fieldErrors is
  // non-empty so the unchecked return path is unreachable.
  const fieldErrors = collectManifestErrors(migrated);
  if (fieldErrors.length > 0) {
    throw new HatchError(
      `Invalid manifest in ${manifestPath}: ${fieldErrors.join("; ")}. Run hatch3r init to regenerate.`,
      undefined,
      "CONFIG_ERROR",
      `Correct the field(s) listed above in ${manifestPath}, or run \`hatch3r init\` to regenerate a valid manifest.`,
    );
  }
  if (!validateManifest(migrated)) {
    // Defense in depth — collectManifestErrors must keep parity with
    // validateManifest. This branch is unreachable when both stay in sync.
    throw new HatchError(
      `Invalid manifest in ${manifestPath}: shape mismatch beyond per-field checks. Run hatch3r init to regenerate.`,
      undefined,
      "CONFIG_ERROR",
      `Run \`hatch3r init\` to regenerate ${manifestPath}; if you hand-edited it, restore the last committed copy with \`git checkout -- ${HATCH3R_DIR}/${MANIFEST_FILE}\`.`,
    );
  }
  return migrated;
}

export async function writeManifest(
  rootDir: string,
  manifest: HatchManifest,
): Promise<void> {
  // C8-D1-M2: Validate manifest schema before persisting to disk.
  // D1-M13: include per-field diagnostics so callers immediately see which
  // field is malformed instead of guessing.
  const writeFieldErrors = collectManifestErrors(manifest);
  if (writeFieldErrors.length > 0) {
    throw new HatchError(
      "Invalid manifest schema: " + writeFieldErrors.join("; ") + ". " +
      "Expected valid HatchManifest with tools, mcp, managedFiles populated.",
      undefined,
      "CONFIG_ERROR",
      `Re-run the command that triggered this write; if it persists, run \`hatch3r init\` to rebuild ${HATCH3R_DIR}/${MANIFEST_FILE} from a known-good state.`,
    );
  }
  const manifestPath = join(rootDir, HATCH3R_DIR, MANIFEST_FILE);
  // Wave 6: ensure the destination directory exists. `writeManifest` is the
  // first writer touching `.hatch3r/` in several pipelines (workspace init,
  // some test fixtures); pre-creating the directory keeps the atomic write
  // from failing with ENOENT on the temp-file path.
  await mkdir(dirname(manifestPath), { recursive: true });
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export function addManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  if (!manifest.managedFiles.includes(filePath)) {
    manifest.managedFiles.push(filePath);
  }
}

export function removeManagedFile(
  manifest: HatchManifest,
  filePath: string,
): void {
  manifest.managedFiles = manifest.managedFiles.filter((f) => f !== filePath);
}

/**
 * Subset of {@link HatchManifest} that carries user- and platform-specific state
 * which must survive `hatch3r clean` -> reinit and plain `hatch3r init` over an
 * existing `.hatch3r/hatch.json`. Init options (platform, owner, repo, tools,
 * features, content, mcp) are intentionally excluded — those are user-confirmed
 * each run and must win over preserved values.
 *
 * `worktreeExtras` is split out so applying preserved extras never toggles
 * `manifest.worktree.enabled` on a user who opted out of worktrees on re-init.
 */
export interface PreservedManifestFields {
  board?: BoardConfig;
  costTracking?: CostTrackingConfig;
  specs?: HatchManifest["specs"];
  userContent?: HatchManifest["userContent"];
  hooks?: HooksConfig;
  models?: ModelConfig;
  claude?: ClaudeConfig;
  repos?: RepoEntry[];
  packages?: PackageEntry[];
  workspace?: HatchManifest["workspace"];
  /**
   * CLI-tooling pivot selection (added in 1.7.5). Preserved across `clean`
   * -> reinit so a user who opted in to ripgrep+jq does not have to re-pick
   * after running `hatch3r clean`. New init may override (init-supplied
   * selections always win over preserved, mirroring the board-config rule).
   */
  cliTools?: CliToolsConfig;
  worktreeExtras?: {
    extraPatterns?: string[];
    nodeModules?: "symlink" | "skip";
  };
}

export function extractPreservedManifestFields(
  manifest: HatchManifest,
): PreservedManifestFields {
  const out: PreservedManifestFields = {};
  if (manifest.board) out.board = manifest.board;
  if (manifest.costTracking) out.costTracking = manifest.costTracking;
  if (manifest.specs) out.specs = manifest.specs;
  if (manifest.userContent) out.userContent = manifest.userContent;
  if (manifest.hooks) out.hooks = manifest.hooks;
  if (manifest.models) out.models = manifest.models;
  if (manifest.claude) out.claude = manifest.claude;
  if (manifest.repos) out.repos = manifest.repos;
  if (manifest.packages) out.packages = manifest.packages;
  if (manifest.workspace) out.workspace = manifest.workspace;
  if (manifest.cliTools) out.cliTools = manifest.cliTools;
  if (
    manifest.worktree?.extraPatterns !== undefined ||
    manifest.worktree?.nodeModules !== undefined
  ) {
    out.worktreeExtras = {};
    if (manifest.worktree.extraPatterns !== undefined) {
      out.worktreeExtras.extraPatterns = manifest.worktree.extraPatterns;
    }
    if (manifest.worktree.nodeModules !== undefined) {
      out.worktreeExtras.nodeModules = manifest.worktree.nodeModules;
    }
  }
  return out;
}

/**
 * Mutate `manifest` in place, applying fields from `preserved`. Init-supplied
 * board owner/repo/defaultBranch always win — the user may be re-pointing the
 * project at a different repo while keeping their GitHub Projects v2 IDs (the
 * same semantics as `hatch3r config` at src/cli/commands/config.ts:557-560).
 *
 * Worktree extras only apply when the new manifest enables worktrees, so a
 * user who turned worktrees off during re-init does not end up with a
 * disabled config carrying stale `extraPatterns`.
 */
export function applyPreservedManifestFields(
  manifest: HatchManifest,
  preserved: PreservedManifestFields,
): void {
  if (preserved.board) {
    if (manifest.board) {
      manifest.board = {
        ...preserved.board,
        owner: manifest.board.owner,
        repo: manifest.board.repo,
        defaultBranch: manifest.board.defaultBranch ?? preserved.board.defaultBranch,
      };
    } else {
      // No new init-supplied board, but top-level manifest.owner/repo carry
      // the init-supplied identity (createManifest sets them unconditionally).
      // Override the preserved board's owner/repo so a re-init that re-points
      // the project does not leave manifest.board.{owner,repo} disagreeing
      // with manifest.{owner,repo}. Fall back to preserved values when the
      // new manifest has no identity set.
      manifest.board = {
        ...preserved.board,
        owner: manifest.owner || preserved.board.owner,
        repo: manifest.repo || preserved.board.repo,
      };
    }
  }
  if (preserved.costTracking) manifest.costTracking = preserved.costTracking;
  if (preserved.specs) manifest.specs = preserved.specs;
  if (preserved.userContent) manifest.userContent = preserved.userContent;
  if (preserved.hooks) manifest.hooks = preserved.hooks;
  if (preserved.models) manifest.models = preserved.models;
  if (preserved.claude) manifest.claude = preserved.claude;
  if (preserved.repos) manifest.repos = preserved.repos;
  if (preserved.packages) manifest.packages = preserved.packages;
  if (preserved.workspace) manifest.workspace = preserved.workspace;
  // init-supplied cliTools always wins (mirrors features / mcp re-confirmation
  // semantics); preserve only when re-init did not supply its own selection.
  if (preserved.cliTools && manifest.cliTools === undefined) {
    manifest.cliTools = preserved.cliTools;
  }
  if (preserved.worktreeExtras && manifest.worktree?.enabled) {
    if (preserved.worktreeExtras.extraPatterns !== undefined) {
      manifest.worktree.extraPatterns = preserved.worktreeExtras.extraPatterns;
    }
    if (preserved.worktreeExtras.nodeModules !== undefined) {
      manifest.worktree.nodeModules = preserved.worktreeExtras.nodeModules;
    }
  }
}

/**
 * D1-SA1.6-F9 (Low, CQ8): named sentinel for the CLI-tooling default, mirroring
 * the named-constant fallback pattern that {@link readMaturityTier} already uses
 * via `DEFAULT_MATURITY_TIER`. Before this, `readCliToolsConfig` inlined the
 * `{ enabled: false, selected: [] }` literal while `readMaturityTier` used a
 * named constant — two "optional field with safe default" readers exposing two
 * different patterns. Defining the default once here gives both readers one
 * consistent rule (named constant) without widening scope into `types.ts`.
 *
 * Frozen so an accidental mutation of the returned default by a future caller
 * fails loudly rather than silently corrupting the sentinel for every other
 * caller; `readCliToolsConfig` returns a fresh shallow copy to preserve the
 * prior "new object per call" semantics for callers that mutate the result.
 */
const DEFAULT_CLI_TOOLS_CONFIG: Readonly<CliToolsConfig> = Object.freeze({
  enabled: false,
  selected: [] as CliToolsConfig["selected"],
});

/**
 * Read the manifest's CLI-tooling pivot config, falling back to the
 * {@link DEFAULT_CLI_TOOLS_CONFIG} default when absent. Plan §4.2 — keeps
 * pre-1.7.5 manifests valid (no version bump required) by returning a
 * disabled-config sentinel rather than `undefined`. Centralises the
 * default so adapters and CLI commands do not duplicate the literal.
 */
export function readCliToolsConfig(m: HatchManifest): CliToolsConfig {
  return m.cliTools ?? { ...DEFAULT_CLI_TOOLS_CONFIG, selected: [...DEFAULT_CLI_TOOLS_CONFIG.selected] };
}

/**
 * Read the manifest's maturity tier (Decision 4 / #16). Absence collapses to
 * `DEFAULT_MATURITY_TIER` ("solo") so pre-2.0 manifests stay valid without a
 * schema version bump.
 *
 * As of F1.2-H2 (Cycle 10) an out-of-enum persisted `maturity` is rejected at
 * the persistence boundary by `validateManifest`, so a manifest that reaches
 * this function has already passed that membership check. The fallback here is
 * retained as defense-in-depth for the `null`/`undefined` manifest callers
 * (e.g. callers that pass a not-yet-read manifest) and for the absent-field
 * case; the `config maturity=<tier>` setter also rejects invalid input at
 * write time.
 */
export function readMaturityTier(m: HatchManifest | null | undefined): MaturityTier {
  const value = m?.maturity;
  if (value && VALID_MATURITY_TIERS.has(value)) {
    return value;
  }
  return DEFAULT_MATURITY_TIER;
}

/**
 * D6-29 (Cycle 11 Wave 3, D6, P3/P7): single-source maturity-marker directive
 * payload shared by all three adapters (claude/cursor/copilot). Before this,
 * each adapter inlined its own directive string and they had drifted — copilot
 * said "The universal floor", "accessibility basics", and "baseline tests on
 * changed surfaces" with a backtick-wrapped rule path, while claude/cursor said
 * "Universal floor", "a11y basics", and "baseline tests" with a bare rule path.
 * The maturity-marker contract is the directive PAYLOAD (this string), applied
 * identically across adapters; each adapter keeps its native wrapper (claude and
 * cursor wrap it in an HTML comment so it renders invisibly while staying
 * greppable; copilot emits it as a blockquote line in copilot-instructions.md).
 * `efficiencyParity.test.ts` asserts the three adapters emit this exact payload
 * for the same canonical input. The per-adapter tests assert the interpolated
 * `right-size to maturity=<tier>` substring + the `rules/hatch3r-right-sizing.md`
 * pointer, both of which this string carries.
 */
export function maturityDirective(tier: MaturityTier): string {
  return `hatch3r: right-size to maturity=${tier}. Invest only as deep as this tier needs; never default to enterprise-grade. Universal floor (security, correctness, a11y basics, baseline tests on changed surfaces) always binds. See rules/hatch3r-right-sizing.md.`;
}

/**
 * Lowest maturity rank that defaults the agent-assertiveness floor to `"high"`
 * when the manifest carries no explicit `confidenceFloor` (D13-SA13.3-F2). Ranks
 * come from {@link MATURITY_TIER_RANK}: solo=0, team=1, scaleup=2, enterprise=3.
 * `scaleup`+`enterprise` (rank >= 2) default `high`; `solo`+`team` default
 * `DEFAULT_CONFIDENCE_FLOOR` ("any"). This wires the calibration the orchestrator
 * docs already promised ("solo defaults any, enterprise defaults high").
 */
const HIGH_FLOOR_MATURITY_RANK = MATURITY_TIER_RANK.scaleup;

/**
 * D13-SA13.3-F13.3.3 / -F2 (Pillar P1): resolve the agent-assertiveness floor.
 *
 * Precedence:
 * 1. An explicit, in-enum `confidenceFloor` on the manifest wins unconditionally
 *    — the per-repo override the user set via `hatch3r config confidence_floor`.
 * 2. On absence, the default is maturity-aware (D13-SA13.3-F2): `scaleup` and
 *    `enterprise` (rank >= {@link HIGH_FLOOR_MATURITY_RANK}) default `"high"`;
 *    `solo` and `team` default `DEFAULT_CONFIDENCE_FLOOR` ("any"). A `null` /
 *    `undefined` manifest resolves to `"solo"` via {@link readMaturityTier} and
 *    so keeps the "any" default — preserving pre-2.0 behavior on unread
 *    manifests.
 *
 * An out-of-enum persisted floor is already rejected at the persistence boundary
 * by `validateManifest`; the membership re-check here is defense-in-depth for the
 * `null`/`undefined` and corrupt-manifest callers, mirroring `readMaturityTier`.
 */
export function readConfidenceFloor(m: HatchManifest | null | undefined): ConfidenceFloor {
  const value = m?.confidenceFloor;
  if (value && VALID_CONFIDENCE_FLOORS.has(value)) {
    return value;
  }
  return MATURITY_TIER_RANK[readMaturityTier(m)] >= HIGH_FLOOR_MATURITY_RANK
    ? "high"
    : DEFAULT_CONFIDENCE_FLOOR;
}

/**
 * D1-17 (Cycle 11 Wave 3, D1, P1): single-source confidence-floor marker
 * directive, the agent-assertiveness analog of {@link maturityDirective}.
 *
 * Pre-fix the persisted `confidenceFloor` (set via `hatch3r config
 * confidence_floor=<floor>` and resolved by {@link readConfidenceFloor}) was
 * validated and stored but NEVER reached any adapter output: no generated
 * `.cursor/` / `.claude/` / `.github/` artifact carried the value, so an agent
 * reading the generated content could not know which review-gate floor the user
 * configured (in contrast to the maturity tier, which every adapter stamps via
 * {@link maturityDirective}). This payload carries the resolved floor and its
 * second-pass effect into the same per-adapter marker surface, so the four core
 * orchestrators (`hatch3r-workflow`, `hatch3r-board-pickup`,
 * `hatch3r-quick-change`, `hatch3r-revision`) read the configured floor from the
 * artifact they already load instead of it being a write-only config key.
 *
 * The effect text mirrors the per-floor semantics documented on `ConfidenceFloor`
 * in `src/types.ts` and applied by `evaluateReviewGate` in
 * `src/pipeline/reviewLoop.ts`: `high` forces a second pass on any verdict that
 * is not `high` confidence; `medium` forces a second pass on `low`; `any` (the
 * default) only forces a second pass on a top-level `low` finding. Like
 * `maturityDirective`, each adapter keeps its native wrapper (claude/cursor wrap
 * it in an HTML comment so it renders invisibly while staying greppable; copilot
 * emits it as a blockquote line).
 */
export function confidenceFloorDirective(floor: ConfidenceFloor): string {
  const effect: Record<ConfidenceFloor, string> = {
    any: "force a second review pass only on a top-level low-confidence finding",
    medium: "force a second review pass on any low-confidence finding",
    high: "force a second review pass on any verdict below high confidence",
  };
  return `hatch3r: confidence floor=${floor}. Core orchestrators ${effect[floor]} before a clean verdict; the floor never relaxes the Critical/Warning fail gates. Set via \`hatch3r config confidence_floor=<any|medium|high>\`.`;
}
