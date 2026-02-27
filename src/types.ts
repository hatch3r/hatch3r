export interface ModelConfig {
  default?: string;
  agents?: Record<string, string>;
}

export interface HatchManifest {
  version: string;
  hatch3rVersion: string;
  owner: string;
  repo: string;
  tools: Tool[];
  features: Features;
  mcp: McpConfig;
  board?: BoardConfig;
  repos?: RepoEntry[];
  packages?: PackageEntry[];
  hooks?: HooksConfig;
  models?: ModelConfig;
  managedFiles: string[];
}

export type Tool = "cursor" | "copilot" | "claude" | "opencode" | "windsurf" | "amp" | "codex" | "gemini" | "cline" | "aider" | "kiro" | "goose" | "zed";

export interface BoardConfig {
  owner: string;
  repo: string;
  /** Default branch for checkout, PR base, and release. Fallback: "main". */
  defaultBranch?: string;
  projectNumber: number | null;
  statusFieldId: number | null;
  statusOptions: {
    backlog: string | null;
    ready: string | null;
    inProgress: string | null;
    inReview: string | null;
    done: string | null;
  };
  labels: {
    types: string[];
    executors: string[];
    statuses: string[];
    meta: string[];
  };
  branchConvention: string;
  areas: string[];
}

export interface RepoEntry {
  owner: string;
  repo: string;
  name?: string;
}

export interface PackageEntry {
  name: string;
  path: string;
}

export interface Features {
  agents: boolean;
  skills: boolean;
  rules: boolean;
  prompts: boolean;
  commands: boolean;
  mcp: boolean;
  guardrails: boolean;
  githubAgents: boolean;
  hooks: boolean;
}

export interface McpConfig {
  servers: string[];
}

export interface HooksConfig {
  enabled: boolean;
}

export interface CanonicalFile {
  id: string;
  type: "rule" | "agent" | "skill" | "command" | "prompt" | "github-agent" | "hook";
  description: string;
  scope?: string;
  model?: string;
  content: string;
  rawContent: string;
  sourcePath: string;
}

export interface CanonicalMetadata {
  id: string;
  type: string;
  description: string;
  scope?: string;
  name?: string;
  [key: string]: string | undefined;
}

export interface AdapterOutput {
  path: string;
  content: string;
  /** Inner content for the managed block (used for merge on update). */
  managedContent?: string;
  action: "create" | "update" | "skip";
}

export interface MergeResult {
  path: string;
  action: "created" | "updated" | "skipped" | "backed-up";
  backup?: string;
}

export interface SyncReport {
  results: MergeResult[];
  warnings: string[];
  errors: string[];
}

export interface RepoInfo {
  languages: string[];
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  isMonorepo: boolean;
  hasExistingAgents: boolean;
  existingTools: Tool[];
  rootDir: string;
}

export const MANAGED_BLOCK_START = "<!-- HATCH3R:BEGIN -->";
export const MANAGED_BLOCK_END = "<!-- HATCH3R:END -->";
export const HATCH3R_PREFIX = "hatch3r-";
export const AGENTS_DIR = ".agents";

/** Returns id with exactly one hatch3r- prefix (strips existing prefix before adding). */
export function toPrefixedId(id: string, prefix = HATCH3R_PREFIX): string {
  const base = id.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
  return `${prefix}${base}`;
}
export const MANIFEST_FILE = "hatch.json";

export const DEFAULT_FEATURES: Features = {
  agents: true,
  skills: true,
  rules: true,
  prompts: true,
  commands: true,
  mcp: true,
  guardrails: false,
  githubAgents: true,
  hooks: true,
};

export interface McpServerMeta {
  description: string;
  requiresEnv?: string[];
}

export const ENV_VAR_HELP: Record<string, { comment: string; url: string }> = {
  GITHUB_PAT: {
    comment: "GitHub MCP server (classic PAT: repo, read:org — or fine-grained: Contents/Issues/PRs)",
    url: "https://github.com/settings/tokens/new",
  },
  BRAVE_API_KEY: {
    comment: "Brave Search (free: 2,000 queries/month)",
    url: "https://brave.com/search/api/",
  },
  SENTRY_AUTH_TOKEN: {
    comment: "Sentry error tracking",
    url: "https://sentry.io/settings/account/api/auth-tokens/",
  },
  POSTGRES_URL: {
    comment: "PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db)",
    url: "",
  },
  LINEAR_API_KEY: {
    comment: "Linear issue tracking",
    url: "https://linear.app/settings/api",
  },
};

export const AVAILABLE_MCP_SERVERS: Record<string, McpServerMeta> = {
  github: {
    description:
      "GitHub repository management, code review, issues, PRs, and project boards",
    requiresEnv: ["GITHUB_PAT"],
  },
  context7: {
    description:
      "Up-to-date, version-specific library documentation for LLMs",
  },
  filesystem: {
    description: "File management and code editing operations",
  },
  playwright: {
    description: "Browser automation, web testing, and UI interaction",
  },
  "brave-search": {
    description:
      "Web research, fact-checking, and current information retrieval",
    requiresEnv: ["BRAVE_API_KEY"],
  },
  sentry: {
    description:
      "Error tracking and performance monitoring (enable and configure with your Sentry auth token)",
    requiresEnv: ["SENTRY_AUTH_TOKEN"],
  },
  postgres: {
    description:
      "PostgreSQL database queries and schema inspection (enable and configure with your connection string)",
    requiresEnv: ["POSTGRES_URL"],
  },
  linear: {
    description:
      "Linear issue tracking and project management (enable and configure with your Linear API key)",
    requiresEnv: ["LINEAR_API_KEY"],
  },
};
