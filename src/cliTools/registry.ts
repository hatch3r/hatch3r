import type { CliToolId } from "../types.js";

/**
 * Supported operating system keys for per-OS install commands. Matches the
 * three platforms hatch3r's CI matrix covers (`ubuntu-latest`,
 * `macos-latest`, `windows-latest`). WSL is treated as `linux` because the
 * apt install commands run identically there.
 */
export type OsKey = "mac" | "linux" | "win";

/** Tier classification for the CLI-tooling pivot — see plan §3. */
export type Tier = 1 | 2 | 3;

/**
 * One install command for a given OS via a specific package manager. The
 * `manager` field is a hint for the picker UI (so the user can prefer
 * `brew` over `cargo` when both are listed); the `command` field is the
 * exact string copy-paste-printed by the installer module — it is never
 * executed automatically.
 */
export interface InstallCommand {
  manager: string;
  command: string;
}

/**
 * Trigger condition for a tier-2 conditional tool. Evaluated by
 * `src/cliTools/triggers.ts::evaluateTier2Triggers` against the project's
 * `RepoInfo` plus the active `Platform`.
 */
export type Tier2Trigger =
  | "web-project"
  | "data-project"
  | "rust-project"
  | "python-project"
  | "docker-detected"
  | "ci-llm-project"
  | "interactive-tty"
  | "gitlab-remote"
  | "azure-remote";

/**
 * Release cadence classification for a CLI tool. Drives the staleness
 * heuristic in `src/cliTools/triggers.ts` (Cycle 9 D21-SA21.2): a long gap
 * since the last release is not automatically a stale-tool finding when the
 * cadence is `stable` (mature tool with a steady-state design) — e.g.
 * sd 1.1.0 (447 days at 2026-05-18) is intentional, not abandoned.
 *
 * - `rapid`: monthly or faster release cadence (e.g. gh CLI).
 * - `monthly`: roughly monthly point releases.
 * - `quarterly`: ~quarterly minor releases.
 * - `stable`: mature steady-state — long gaps between releases are normal.
 */
export type ReleaseCadence = "rapid" | "monthly" | "quarterly" | "stable";

/**
 * Cycle-tagged CVE-scan record for a CLI tool — populated by the audit cycle
 * (Cycle 9 D15-SA15.7) when an advisory feed is consulted. Schema only at
 * Wave 2; population happens in the per-cycle `check-cli-cves.ts` workflow
 * scheduled by D21 close.
 */
export interface CveScan {
  /** ISO-8601 date the CVE feed was last queried for this tool. */
  last_checked: string;
  /** Advisory count returned by the feed at `last_checked` (0 = clean). */
  advisory_count: number;
  /**
   * Canonical advisory URL — typically GHSA or NVD. Empty string when the
   * feed reported zero advisories and no aggregate-report URL exists.
   */
  report_url: string;
}

/**
 * Catalog entry for a single CLI tool. The `id` is the canonical
 * identifier (kebab-case, matches the `hatch3r-cli-{id}` skill directory
 * name); `probe` is the binary name passed to `command -v` / `where`.
 */
export interface CliToolMeta {
  /** Canonical kebab-case identifier (also drives the skill directory name). */
  id: CliToolId;
  /** Binary name passed to detection probes. */
  probe: string;
  description: string;
  category: "search" | "json" | "yaml" | "git" | "view" | "edit" | "archive" | "web" | "data" | "http" | "forge" | "browser" | "container" | "ai" | "interactive";
  tier: Tier;
  /** Per-OS install commands, ordered most-preferred first. */
  install: Record<OsKey, InstallCommand[]>;
  /** Optional env vars required at runtime (e.g. `GH_TOKEN` for `gh`). */
  requiresEnv?: string[];
  /** Tier-2 trigger condition (omitted for tier-1 and tier-3). */
  trigger?: Tier2Trigger;
  /** Free-form caveat string (e.g. RTK pipe-output corruption). */
  caveat?: string;
  /**
   * Security advisory note — populated when the upstream tool has an active
   * CVE that ships in the recommended install version. Surfaced verbatim by
   * the picker/installer and embedded in the generated skill's Known Issues
   * section. Format: `CVE-YYYY-NNNNN: <one-line impact summary>`.
   */
  securityNote?: string;
  /**
   * Minimum acceptable upstream version, expressed as a semver range string
   * (e.g. `">=2.92.0"`, `"29.5.0"`). Surfaced by the installer alongside the
   * install command so users on older builds know to upgrade before relying
   * on the tool — typically populated when a recent CVE patch lands in a
   * specific tagged release. Omit when no minimum is asserted.
   */
  minVersion?: string;
  /**
   * Upstream release cadence classification — drives the staleness heuristic
   * in `src/cliTools/triggers.ts` so a long gap on a stable-cadence tool is
   * not flagged as abandoned. Omit to fall back to the default heuristic
   * (treat any tool >180 days since last release as candidate-stale).
   */
  releaseCadence?: ReleaseCadence;
  /**
   * Cycle-tagged CVE-scan record — populated by the per-cycle
   * `check-cli-cves.ts` workflow (Cycle 9 D15-SA15.7-F01). Schema only at
   * Wave 2; population happens in a follow-on cycle once the advisory-feed
   * script lands. Omit when no scan has been recorded for this tool yet.
   */
  cve_scan?: CveScan;
  homepage: string;
}

/**
 * Authoritative CLI tool catalog. Entries added here are picked up by the
 * picker, detection, install printer, and (in Wave 4) the skill generator
 * via `scripts/generate-cli-skills.ts`. Use the plan §3 install commands
 * verbatim — they were vendor-verified during research.
 */
export const AVAILABLE_CLI_TOOLS = {
  // ── Tier 1 (10 tools) ───────────────────────────────────────────
  ripgrep: {
    id: "ripgrep",
    probe: "rg",
    description: "Fast recursive grep with sane defaults and gitignore awareness",
    category: "search",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install ripgrep" }],
      linux: [{ manager: "apt", command: "sudo apt install ripgrep" }],
      win: [{ manager: "scoop", command: "scoop install ripgrep" }],
    },
    homepage: "https://github.com/BurntSushi/ripgrep",
  },
  fd: {
    id: "fd",
    probe: "fd",
    description: "User-friendly find replacement, gitignore-aware",
    category: "search",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install fd" }],
      linux: [{ manager: "apt", command: "sudo apt install fd-find" }],
      win: [{ manager: "scoop", command: "scoop install fd" }],
    },
    homepage: "https://github.com/sharkdp/fd",
  },
  jq: {
    id: "jq",
    probe: "jq",
    description: "JSON processor and query language",
    category: "json",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install jq" }],
      linux: [{ manager: "apt", command: "sudo apt install jq" }],
      win: [{ manager: "scoop", command: "scoop install jq" }],
    },
    // Release-watch: monitor jqlang/jq releases for a tagged build past 1.8.1
    // that includes the upstream patches for CVE-2026-32316 et al; remove the
    // securityNote once the recommended install version is on a patched tag.
    // Cycle 9 D21-SA21.3-F03 (C9-H87): the 2026-04-15 oss-sec batch enumerated
    // CVE-2026-40612 (stack overflow in jv_contains), CVE-2026-43894 (integer
    // overflow), and CVE-2026-43896 (stack overflow in recursive object merge)
    // explicitly; three additional CVE IDs from the same batch were not
    // assigned canonical IDs in the audit sources and remain referenced by
    // batch (seclists.org/oss-sec/2026/q2/141).
    securityNote:
      "CVE-2026-32316: jq 1.8.1 ships with a heap buffer overflow in expression evaluation; six additional CVEs disclosed 2026-04-15 are patched on main but no tagged release yet — three confirmed by ID (CVE-2026-40612 stack overflow in jv_contains, CVE-2026-43894 integer overflow, CVE-2026-43896 stack overflow in recursive object merge); the remaining three are referenced by oss-sec batch (https://seclists.org/oss-sec/2026/q2/141). Avoid invoking on untrusted JSON inputs until the next jq tagged release supersedes 1.8.1.",
    homepage: "https://github.com/jqlang/jq",
  },
  yq: {
    id: "yq",
    probe: "yq",
    description: "YAML processor (mikefarah Go implementation)",
    category: "yaml",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install yq" }],
      linux: [{ manager: "snap", command: "sudo snap install yq" }],
      win: [{ manager: "scoop", command: "scoop install yq" }],
    },
    homepage: "https://github.com/mikefarah/yq",
  },
  gh: {
    id: "gh",
    probe: "gh",
    description: "GitHub CLI — repos, issues, PRs, releases, gists",
    category: "forge",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install gh" }],
      linux: [{ manager: "apt", command: "sudo apt install gh" }],
      win: [{ manager: "winget", command: "winget install GitHub.cli" }],
    },
    requiresEnv: ["GH_TOKEN"],
    // Cycle 9 D21-SA21.5-F01 (C9-H88): gh <2.92.0 is exposed to
    // GHSA-crc3-h8v6-qh57; the 2.92.0 release (2026-05-06) ships the fix.
    minVersion: ">=2.92.0",
    securityNote:
      "GHSA-crc3-h8v6-qh57: gh CLI before 2.92.0 may leak authentication tokens via auxiliary host extension calls. Upgrade to 2.92.0 or later before using gh against untrusted GitHub Enterprise hosts.",
    homepage: "https://cli.github.com/",
  },
  delta: {
    id: "delta",
    probe: "delta",
    description: "Syntax-highlighting git diff pager",
    category: "git",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install git-delta" }],
      linux: [{ manager: "apt", command: "sudo apt install git-delta" }],
      win: [{ manager: "scoop", command: "scoop install delta" }],
    },
    homepage: "https://github.com/dandavison/delta",
  },
  bat: {
    id: "bat",
    probe: "bat",
    description: "cat clone with syntax highlighting and git integration",
    category: "view",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install bat" }],
      linux: [{ manager: "apt", command: "sudo apt install bat" }],
      win: [{ manager: "winget", command: "winget install sharkdp.bat" }],
    },
    homepage: "https://github.com/sharkdp/bat",
  },
  sd: {
    id: "sd",
    probe: "sd",
    description: "Intuitive sed replacement with literal string patterns",
    category: "edit",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install sd" }],
      linux: [{ manager: "cargo", command: "cargo install sd" }],
      win: [{ manager: "scoop", command: "scoop install sd" }],
    },
    // Cycle 9 D21-SA21.2-F01: sd 1.1.0 (released 2025-02-24) was 447 days old
    // at the 2026-05-18 audit. The chmln/sd project is mature steady-state —
    // long gaps between minor releases are intentional, not abandonment.
    // Tagged `stable` so the staleness heuristic stops flagging this entry.
    releaseCadence: "stable",
    homepage: "https://github.com/chmln/sd",
  },
  "ast-grep": {
    id: "ast-grep",
    probe: "sg",
    description: "Structural search and rewrite for code via AST patterns",
    category: "search",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install ast-grep" }],
      linux: [{ manager: "cargo", command: "cargo install ast-grep" }],
      win: [{ manager: "scoop", command: "scoop install ast-grep" }],
    },
    homepage: "https://ast-grep.github.io/",
  },
  zstd: {
    id: "zstd",
    probe: "zstd",
    description: "Fast lossless compression with high ratio",
    category: "archive",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install zstd" }],
      linux: [{ manager: "apt", command: "sudo apt install zstd" }],
      win: [{ manager: "winget", command: "winget install Facebook.Zstandard" }],
    },
    homepage: "https://github.com/facebook/zstd",
  },

  // ── Tier 2 (11 tools, conditional) ──────────────────────────────
  playwright: {
    id: "playwright",
    probe: "playwright",
    description: "Browser automation, web testing, and UI interaction",
    category: "browser",
    tier: 2,
    trigger: "web-project",
    install: {
      mac: [{ manager: "npm", command: "npm install -D @playwright/test && npx playwright install" }],
      linux: [{ manager: "npm", command: "npm install -D @playwright/test && npx playwright install --with-deps" }],
      win: [{ manager: "npm", command: "npm install -D @playwright/test && npx playwright install" }],
    },
    homepage: "https://playwright.dev/",
  },
  duckdb: {
    id: "duckdb",
    probe: "duckdb",
    description: "Embedded analytical database with first-class CSV/Parquet support",
    category: "data",
    tier: 2,
    trigger: "data-project",
    install: {
      mac: [{ manager: "brew", command: "brew install duckdb" }],
      linux: [{ manager: "curl", command: "curl https://install.duckdb.org | sh" }],
      win: [{ manager: "winget", command: "winget install DuckDB.cli" }],
    },
    homepage: "https://duckdb.org/",
  },
  qsv: {
    id: "qsv",
    probe: "qsv",
    description: "Fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained xsv successor",
    category: "data",
    tier: 2,
    trigger: "data-project",
    install: {
      mac: [{ manager: "brew", command: "brew install qsv" }],
      linux: [{ manager: "cargo", command: "cargo install qsv --locked --features all_features" }],
      win: [{ manager: "cargo", command: "cargo install qsv --locked --features all_features" }],
    },
    homepage: "https://github.com/jqnatividad/qsv",
  },
  taplo: {
    id: "taplo",
    probe: "taplo",
    description: "TOML toolkit (format, lint, query) for pyproject.toml / Cargo.toml",
    category: "yaml",
    tier: 2,
    trigger: "rust-project",
    install: {
      mac: [{ manager: "brew", command: "brew install taplo" }],
      linux: [{ manager: "cargo", command: "cargo install taplo-cli --locked" }],
      win: [{ manager: "scoop", command: "scoop install taplo" }],
    },
    homepage: "https://taplo.tamasfe.dev/",
  },
  glab: {
    id: "glab",
    probe: "glab",
    description: "GitLab CLI — merge requests, issues, pipelines",
    category: "forge",
    tier: 2,
    trigger: "gitlab-remote",
    install: {
      mac: [{ manager: "brew", command: "brew install glab" }],
      linux: [{ manager: "apt", command: "sudo apt install glab" }],
      win: [{ manager: "winget", command: "winget install GitLab.GLab" }],
    },
    requiresEnv: ["GITLAB_TOKEN"],
    homepage: "https://gitlab.com/gitlab-org/cli",
  },
  "az-devops": {
    id: "az-devops",
    probe: "az",
    description: "Azure DevOps work items, repos, pipelines via az CLI extension",
    category: "forge",
    tier: 2,
    trigger: "azure-remote",
    install: {
      mac: [{ manager: "brew", command: "brew install azure-cli && az extension add --name azure-devops" }],
      linux: [{ manager: "curl", command: "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash && az extension add --name azure-devops" }],
      win: [{ manager: "winget", command: "winget install Microsoft.AzureCLI && az extension add --name azure-devops" }],
    },
    requiresEnv: ["AZURE_DEVOPS_PAT", "AZURE_DEVOPS_ORG"],
    homepage: "https://learn.microsoft.com/en-us/cli/azure/azure-devops",
  },
  docker: {
    id: "docker",
    probe: "docker",
    description: "Container runtime and CLI",
    category: "container",
    tier: 2,
    trigger: "docker-detected",
    install: {
      mac: [{ manager: "brew", command: "brew install --cask docker" }],
      linux: [{ manager: "curl", command: "curl -fsSL https://get.docker.com | sudo sh" }],
      win: [{ manager: "winget", command: "winget install Docker.DockerDesktop" }],
    },
    // Cycle 9 D21-SA21.6-F02 (C9-H91): Docker engine 29.5.0 patches
    // CVE-2026-32288 — DoS via crafted image manifest in earlier builds.
    minVersion: "29.5.0",
    securityNote:
      "CVE-2026-32288: Docker engine before 29.5.0 is vulnerable to a denial-of-service via a crafted image manifest. Upgrade to 29.5.0 or later before pulling images from untrusted registries.",
    homepage: "https://docs.docker.com/get-docker/",
  },
  llm: {
    id: "llm",
    probe: "llm",
    description: "simonw/llm — invoke LLMs from the command line with prompt templates",
    category: "ai",
    tier: 2,
    trigger: "ci-llm-project",
    install: {
      mac: [{ manager: "brew", command: "brew install llm" }],
      linux: [{ manager: "pipx", command: "pipx install llm" }],
      win: [{ manager: "pipx", command: "pipx install llm" }],
    },
    homepage: "https://llm.datasette.io/",
  },
  fzf: {
    id: "fzf",
    probe: "fzf",
    description: "Interactive fuzzy finder for TTY pickers",
    category: "interactive",
    tier: 2,
    trigger: "interactive-tty",
    install: {
      mac: [{ manager: "brew", command: "brew install fzf" }],
      linux: [{ manager: "apt", command: "sudo apt install fzf" }],
      win: [{ manager: "scoop", command: "scoop install fzf" }],
    },
    homepage: "https://github.com/junegunn/fzf",
  },
  lazygit: {
    id: "lazygit",
    probe: "lazygit",
    description: "Terminal UI for git with keyboard-driven workflows",
    category: "git",
    tier: 2,
    trigger: "interactive-tty",
    install: {
      mac: [{ manager: "brew", command: "brew install lazygit" }],
      linux: [{ manager: "apt", command: "sudo apt install lazygit" }],
      win: [{ manager: "scoop", command: "scoop install lazygit" }],
    },
    homepage: "https://github.com/jesseduffield/lazygit",
  },
  difftastic: {
    id: "difftastic",
    probe: "difft",
    description: "Structural diff that understands syntax",
    category: "git",
    tier: 2,
    trigger: "interactive-tty",
    install: {
      mac: [{ manager: "brew", command: "brew install difftastic" }],
      linux: [{ manager: "cargo", command: "cargo install --locked difftastic" }],
      win: [{ manager: "scoop", command: "scoop install difftastic" }],
    },
    homepage: "https://difftastic.wilfred.me.uk/",
  },

  // ── Tier 3 (8 tools, opt-in advanced) ───────────────────────────
  rtk: {
    id: "rtk",
    probe: "rtk",
    description: "CLI output-compression proxy (see ⚠ caveat)",
    category: "ai",
    tier: 3,
    caveat: "pipe-output-corruption",
    install: {
      mac: [{ manager: "brew", command: "brew install rtk-ai/tap/rtk" }],
      linux: [{ manager: "curl", command: "curl -fsSL https://rtk.dev/install.sh | sh" }],
      win: [{ manager: "scoop", command: "scoop install rtk" }],
    },
    homepage: "https://github.com/rtk-ai/rtk",
  },
  stagehand: {
    id: "stagehand",
    probe: "stagehand",
    description: "Browserbase Stagehand — AI-driven browser automation",
    category: "browser",
    tier: 3,
    install: {
      mac: [{ manager: "npm", command: "npm install -g @browserbasehq/stagehand" }],
      linux: [{ manager: "npm", command: "npm install -g @browserbasehq/stagehand" }],
      win: [{ manager: "npm", command: "npm install -g @browserbasehq/stagehand" }],
    },
    homepage: "https://github.com/browserbase/stagehand",
  },
  aichat: {
    id: "aichat",
    probe: "aichat",
    description: "Multi-provider LLM chat CLI with RAG and session memory",
    category: "ai",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: "brew install aichat" }],
      linux: [{ manager: "cargo", command: "cargo install aichat" }],
      win: [{ manager: "scoop", command: "scoop install aichat" }],
    },
    homepage: "https://github.com/sigoden/aichat",
  },
  mods: {
    id: "mods",
    probe: "mods",
    description: "Charm mods — Unix-friendly LLM pipeline tool",
    category: "ai",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: "brew install charmbracelet/tap/mods" }],
      linux: [{ manager: "apt", command: "sudo apt install mods" }],
      win: [{ manager: "scoop", command: "scoop install mods" }],
    },
    homepage: "https://github.com/charmbracelet/mods",
  },
  comby: {
    id: "comby",
    probe: "comby",
    description: "Structural search and replace across languages with declarative patterns",
    category: "search",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: "brew install comby" }],
      linux: [{ manager: "curl", command: "bash <(curl -sL get.comby.dev)" }],
      win: [{ manager: "scoop", command: "scoop install comby" }],
    },
    homepage: "https://comby.dev/",
  },
  miller: {
    id: "miller",
    probe: "mlr",
    description: "awk/sed/cut/join for CSV/TSV/JSON/Parquet streams",
    category: "data",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: "brew install miller" }],
      linux: [{ manager: "apt", command: "sudo apt install miller" }],
      win: [{ manager: "scoop", command: "scoop install miller" }],
    },
    homepage: "https://miller.readthedocs.io/",
  },
  csvkit: {
    id: "csvkit",
    probe: "csvlook",
    description: "csvkit — Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat)",
    category: "data",
    tier: 3,
    install: {
      mac: [{ manager: "pipx", command: "pipx install csvkit" }],
      linux: [{ manager: "pipx", command: "pipx install csvkit" }],
      win: [{ manager: "pipx", command: "pipx install csvkit" }],
    },
    homepage: "https://csvkit.readthedocs.io/",
  },
  podman: {
    id: "podman",
    probe: "podman",
    description: "Daemonless container engine, rootless by default (Docker alternative)",
    category: "container",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: "brew install podman" }],
      linux: [{ manager: "apt", command: "sudo apt install podman" }],
      win: [{ manager: "winget", command: "winget install RedHat.Podman" }],
    },
    // Cycle 9 D21-SA21.6-F03 (C9-H92): Podman 5.8.2 patches CVE-2026-33414 —
    // a Windows-only PowerShell command injection on the Hyper-V backend via
    // `podman machine init --image`. The note is platform-windows-only; mac
    // and linux builds are not affected, but registry callers surface the
    // single securityNote with the explicit `Windows only` prefix.
    minVersion: "5.8.2",
    securityNote:
      "CVE-2026-33414 (Windows only): Podman before 5.8.2 is vulnerable to PowerShell command injection in `podman machine init --image` on the Hyper-V backend, allowing Hyper-V VM escape. Upgrade to 5.8.2 or later on Windows; mac and linux builds are unaffected.",
    homepage: "https://podman.io/",
  },
} as const satisfies Record<CliToolId, CliToolMeta>;

/** Tier-1 default-on tools (the picker pre-checks these). */
export const TIER1_CLI_TOOLS: readonly CliToolId[] = [
  "ripgrep",
  "fd",
  "jq",
  "yq",
  "gh",
  "delta",
  "bat",
  "sd",
  "ast-grep",
  "zstd",
] as const;

/**
 * Tier-2 tools grouped by their trigger condition (see plan §3). Each
 * trigger maps to the list of tools the picker pre-checks when the
 * condition holds for the active `RepoInfo`/`Platform`.
 */
export const TIER2_CLI_TOOLS_BY_TRIGGER: Readonly<Record<Tier2Trigger, readonly CliToolId[]>> = {
  "web-project": ["playwright"],
  "data-project": ["duckdb", "qsv"],
  "rust-project": ["taplo"],
  "python-project": ["taplo"],
  "docker-detected": ["docker"],
  "ci-llm-project": ["llm"],
  "interactive-tty": ["fzf", "lazygit", "difftastic"],
  "gitlab-remote": ["glab"],
  "azure-remote": ["az-devops"],
};

/** Tier-3 advanced opt-in tools — never pre-checked. */
export const TIER3_CLI_TOOLS: readonly CliToolId[] = [
  "rtk",
  "stagehand",
  "aichat",
  "mods",
  "comby",
  "miller",
  "csvkit",
  "podman",
] as const;

/**
 * Default tier-1 selection used by `--yes` non-interactive init (plus any
 * tier-2 tools whose trigger matches RepoInfo) — see plan §4.3.
 */
export const DEFAULT_CLI_TOOLS: readonly CliToolId[] = TIER1_CLI_TOOLS;

/**
 * Per-tool environment-variable advisory notes surfaced after picker
 * selection (mirrors `TOOL_SECRET_NOTES` for MCP servers in
 * `src/cli/shared/constants.ts`). Only tools whose `requiresEnv` is set
 * appear here — entries are auto-generated from `AVAILABLE_CLI_TOOLS` so
 * adding a new tool with `requiresEnv` propagates without a code change.
 */
export const CLI_TOOL_SECRET_NOTES: Readonly<Record<CliToolId, readonly string[]>> = Object.freeze(
  ((): Record<CliToolId, readonly string[]> => {
    const out: Record<CliToolId, readonly string[]> = {};
    for (const tool of Object.values(AVAILABLE_CLI_TOOLS) as readonly CliToolMeta[]) {
      const env = tool.requiresEnv;
      if (env && env.length > 0) {
        out[tool.id] = [...env];
      }
    }
    return out;
  })(),
);
