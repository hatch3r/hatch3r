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
 * Optional follow-up probe to verify a tool extension is installed AFTER the
 * base binary has been detected on PATH. Closes the false-positive gap for
 * tools whose registry `probe` resolves to a shared binary (e.g. `az` for
 * `az-devops`, which only confirms the Azure CLI itself, not the
 * azure-devops extension). Used by `src/cliTools/detect.ts::detectCliTool`.
 *
 * `args` is the argv tail passed verbatim after the base `probe` binary —
 * each entry is validated against the same character allowlist as the
 * binary name so the command stays shell-injection-safe. `expectInStdout`
 * is the substring that must appear in the extension probe's stdout for the
 * extension to be considered present.
 */
export interface ExtensionProbe {
  /** Argv tail after the base binary (e.g. `["extension", "list", "-o", "tsv"]`). */
  args: readonly string[];
  /** Substring that must appear in stdout for the extension to be present. */
  expectInStdout: string;
  /** Human-readable name of the extension surfaced in detection diagnostics. */
  name: string;
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
   * Optional follow-up extension probe — see `ExtensionProbe`. When set,
   * detection runs the args after the base `probe` succeeds and only
   * reports the tool as installed when `expectInStdout` is found in the
   * follow-up output. Currently set on `az-devops` (D21-M6, Cycle 10) to
   * stop the `command -v az` base probe from reporting installed when
   * Azure CLI ships without the azure-devops extension.
   */
  extensionProbe?: ExtensionProbe;
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
   * Cycle-tagged CVE-scan record — populated by the per-cycle
   * `check-cli-cves.ts` workflow (Cycle 9 D15-SA15.7-F01). Schema only at
   * Wave 2; population happens in a follow-on cycle once the advisory-feed
   * script lands. Omit when no scan has been recorded for this tool yet.
   */
  cve_scan?: CveScan;
  homepage: string;
  /**
   * Canonical source-repository URL — the upstream VCS where the tool's code
   * lives (a GitHub / GitLab repo, never a docs site). Distinct from
   * `homepage`, which is frequently a documentation or marketing site
   * (duckdb.org, learn.microsoft.com/...) rather than the source. Required by
   * the D15.7 provenance contract ("vendor + source URL + license") so every
   * tool's provenance is machine-checkable, not docs-site-only.
   */
  sourceRepo: string;
  /**
   * SPDX license expression for the upstream tool (e.g. `"MIT"`,
   * `"Apache-2.0"`, `"MIT OR Apache-2.0"`, `"BSD-3-Clause OR GPL-2.0-only"`).
   * The third leg of the D15.7 "vendor + source URL + license" provenance
   * requirement. Validated against the SPDX-token shape in
   * `registry.test.ts`. `"curl"` is itself a registered SPDX license id.
   */
  license: string;
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
    // Cycle 10 D21-M1: ripgrep 15.1.0 (released 2025-10-31) is 208 days old at
    // the 2026-05-26 audit. BurntSushi/ripgrep is mature steady-state — the
    // 14.x → 15.x cadence shows multi-month gaps as normal (14.0 Aug 2023,
    // 14.1 Sep 2023, 14.1.1 Apr 2024, 15.0 Oct 2024, 15.1 Oct 2025), so the
    // long gap reflects maturity, not abandonment; the tool is the canonical
    // search primitive across hatch3r-cli-* skills.
    // CVE-2021-3013 (GHSA-g4xg-fxmg-vcg5) OS command injection — fixed in ripgrep 13.0.0
    minVersion: ">=13.0.0",
    homepage: "https://github.com/BurntSushi/ripgrep",
    sourceRepo: "https://github.com/BurntSushi/ripgrep",
    license: "MIT OR Unlicense",
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
    sourceRepo: "https://github.com/sharkdp/fd",
    license: "MIT OR Apache-2.0",
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
    // Cycle 10 D21-SA21.3-F-21.3.1/F-21.3.2 (F-21.7.1): jq 1.8.1 (2025-07-01)
    // remains the only tagged release at 2026-05-27 (330 days). The April-May
    // 2026 disclosure cluster on https://github.com/jqlang/jq/security/advisories
    // listed 10+ GHSA entries covering stack-overflow, integer-overflow, and
    // NUL-truncation classes — all triggerable by attacker-controlled JSON or
    // jq-filter inputs. Until a tagged release supersedes 1.8.1, mitigations
    // are install-side (input validation, sandbox isolation) rather than
    // tool-version-side. minVersion floors the install at the only tag that
    // patches the 2024 CVE-2023-49355 + CVE-2024-53427 1.7.x cluster.
    minVersion: ">=1.8.1",
    securityNote:
      "Multiple unfixed advisories on jq 1.8.1 (the only tagged release as of 2026-05-27). See https://github.com/jqlang/jq/security/advisories for the canonical roster — at audit time the upstream tab listed 10+ GHSA entries (April-May 2026), all stack-overflow / integer-overflow / NUL-truncation classes triggerable by attacker-controlled JSON or attacker-controlled jq filter paths. Validate JSON inputs externally (e.g. python json.tool or jaq) or sandbox jq in a network-isolated container before running on untrusted input.",
    homepage: "https://github.com/jqlang/jq",
    sourceRepo: "https://github.com/jqlang/jq",
    license: "MIT",
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
    // Cycle 11 D21-13 (SA21.3-F5): tested-against version per the D21
    // checklist documentation-pin precedent set by glab (1.99.0) and az-devops
    // (1.0.4) — NOT a CVE-driven floor. Cycle 11 verified yq 4.53.2
    // (2026-04-18). The installer surfaces this as advisory text and the next
    // cycle measures drift against it.
    minVersion: "4.53.2",
    homepage: "https://github.com/mikefarah/yq",
    sourceRepo: "https://github.com/mikefarah/yq",
    license: "MIT",
  },
  gh: {
    id: "gh",
    probe: "gh",
    description: "GitHub CLI — repos, issues, PRs, releases, gists",
    category: "forge",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install gh" }],
      // Cycle 11 D21-17 (SA21.5-F4): bare `sudo apt install gh` fails on stock
      // Debian (no `gh` package) and on older Ubuntu pulls a build far below the
      // registry floor. The recipe below is the upstream cli.github.com apt
      // one-liner from cli/cli docs/install_linux.md (keyring + signed repo add,
      // then `apt install gh`) — the only apt path that yields the current
      // signed release. Subsequent upgrades are `sudo apt update && sudo apt install gh`.
      linux: [
        {
          manager: "apt",
          command:
            '(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) && sudo mkdir -p -m 755 /etc/apt/keyrings && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt update && sudo apt install gh -y',
        },
      ],
      win: [{ manager: "winget", command: "winget install GitHub.cli" }],
    },
    requiresEnv: ["GH_TOKEN"],
    // Cycle 11 D21-1/D21-2 (SA21.5-F1/F2): the prior >=2.92.0 floor + securityNote
    // misattributed the token leak to GHSA-crc3-h8v6-qh57. That advisory is
    // CVE-2026-45803 (CVSS 3.1 LOW, terminal-escape-sequence injection in
    // `gh run view --log`, fixed 2.92.0) — NOT a token leak. The real
    // Authorization-header leak is CVE-2026-48501 / GHSA-8xvp-7hj6-mcj9: gh
    // <=2.92.0 attaches the github.com (or GH_ENTERPRISE_TOKEN) Authorization
    // header to TUF repository-mirror requests via `gh attestation`,
    // `gh release verify`, and `gh release verify-asset`, fixed in 2.93.0
    // (2026-…). Floor raised to >=2.93.0 so installs clear the header leak.
    minVersion: ">=2.93.0",
    // Cycle 10 D21-SA21.5-F-21.5.2: gh ships at rapid cadence (~30-day mean,
    // 7 releases across 2025-06 → 2026-04), so a multi-week pause is itself a
    // currency signal worth re-checking each D21 cycle.
    securityNote:
      "CVE-2026-48501 / GHSA-8xvp-7hj6-mcj9: gh CLI 2.92.0 and earlier attach the Authorization header (github.com token, or GH_ENTERPRISE_TOKEN / GITHUB_ENTERPRISE_TOKEN) to TUF repository-mirror requests made by `gh attestation`, `gh release verify`, and `gh release verify-asset` — leaking the token to hosts such as tuf-repo.github.com / tuf-repo-cdn.sigstore.dev. Fixed in 2.93.0; upgrade before running attestation or release-verify commands. (Separately, CVE-2026-45803 / GHSA-crc3-h8v6-qh57 is a LOW terminal-escape-sequence injection in `gh run view --log`, fixed 2.92.0.)",
    homepage: "https://cli.github.com/",
    sourceRepo: "https://github.com/cli/cli",
    license: "MIT",
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
    // CVE-2021-36376 (GHSA-5xg3-j2j6-rcx4) path traversal — fixed in git-delta 0.8.3
    minVersion: ">=0.8.3",
    homepage: "https://github.com/dandavison/delta",
    sourceRepo: "https://github.com/dandavison/delta",
    license: "MIT",
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
    // Cycle 10 D21-M3: bat 0.26.1 (released 2025-12-12) is 167 days old at the
    // 2026-05-26 audit. sharkdp/bat shares the same author + cadence pattern
    // as fd — mature steady-state tooling with multi-month gaps between
    // minor releases (0.24 Mar 2024, 0.25 Mar 2025, 0.26 Dec 2025), so the
    // long gap reflects maturity, not abandonment; bat is the canonical
    // syntax-aware view tool in hatch3r-cli-toolbox and remains maintained.
    // CVE-2021-36753 (GHSA-p24j-h477-76q3) uncontrolled search path — fixed in bat 0.18.2
    minVersion: ">=0.18.2",
    homepage: "https://github.com/sharkdp/bat",
    sourceRepo: "https://github.com/sharkdp/bat",
    license: "MIT OR Apache-2.0",
  },
  sd: {
    id: "sd",
    probe: "sd",
    description: "Intuitive sed replacement with literal string patterns",
    category: "edit",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install sd" }],
      // Cycle 11 D21-6 (SA21.2-F1): `cargo install sd` resolves to crates.io,
      // whose max published version is 1.0.0 — so the prior Linux recipe pinned
      // 1.0.0 while brew (mac) and scoop (win) ship 1.1.0, and the documented
      // line-by-line default + `-A`/`--across` flag only exist in 1.1.0. The
      // GitHub `v1.1.0` release ships prebuilt Linux binaries (GNU + musl,
      // x86_64 + aarch64); `cargo binstall sd` fetches that GitHub-release
      // binary (not the crates.io 1.0.0 source), aligning Linux on 1.1.0.
      linux: [{ manager: "cargo", command: "cargo binstall sd" }],
      win: [{ manager: "scoop", command: "scoop install sd" }],
    },
    // Cycle 11 D21-10 (SA21.2-F2): the prior comment dated sd 1.1.0 to
    // 2025-02-24 / "447 days old" — wrong by one year. The immutable v1.1.0
    // tag points at commit 4a7b2165, dated 2026-02-25, so at the 2026-05-18
    // audit 1.1.0 was ~82 days old, not 447. The true cadence shape is a
    // ~27-month dormancy (1.0.0 → 1.1.0) ENDED by a recent release: the project
    // was dormant and has just resumed, so the fresh release means it is not
    // abandoned — but D21 should re-check next cycle if 1.1.0 ages past ~180
    // days with no successor.
    // Cycle 11 D21-6 (SA21.2-F1): floored at >=1.1.0 now that all three OS
    // channels (brew, scoop, cargo binstall from the v1.1.0 GitHub release)
    // can satisfy it — the documented line-by-line default + `-A`/`--across`
    // flag are 1.1.0 features absent from the crates.io 1.0.0 build.
    minVersion: ">=1.1.0",
    homepage: "https://github.com/chmln/sd",
    sourceRepo: "https://github.com/chmln/sd",
    license: "MIT",
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
    // Cycle 10 D21-SA21.1-F-21.1.2: ast-grep ships at rapid cadence — five
    // tags in 71 days at audit (0.42.0 2026-03-16, 0.42.1 2026-04-04,
    // 0.42.2 2026-05-10, 0.42.3 2026-05-19, 0.43.0 2026-05-25; ~14-day mean),
    // so a multi-week pause is itself a currency signal worth re-checking each
    // D21 cycle rather than waiting for the default 180-day window.
    homepage: "https://ast-grep.github.io/",
    sourceRepo: "https://github.com/ast-grep/ast-grep",
    license: "MIT",
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
    sourceRepo: "https://github.com/facebook/zstd",
    license: "BSD-3-Clause OR GPL-2.0-only",
  },
  curl: {
    id: "curl",
    probe: "curl",
    description: "HTTP/S transfer tool — POST/GET/PUT, file upload, custom headers, cookies, scripting",
    category: "http",
    tier: 1,
    install: {
      mac: [{ manager: "brew", command: "brew install curl" }],
      linux: [{ manager: "apt", command: "sudo apt install curl" }],
      win: [{ manager: "winget", command: "winget install cURL.cURL" }],
    },
    // Cycle 11 D21-14 (SA21.4-F1): the prior note rolled seven CVEs together
    // as "all fixed in 8.20.0" and labelled the batch "Medium-and-Low" — both
    // wrong. Per curl.se/docs/security.html, CVE-2026-3805 was fixed in 8.18.0
    // and CVE-2026-3783 in 8.17.0 (NOT 8.20.0), and CVE-2026-6253 is High, not
    // Medium/Low. The three advisories actually resolved by the 8.20.0 release
    // are CVE-2026-5773, CVE-2026-5545, and CVE-2026-4873. The floor stays at
    // >=8.20.0 because that build is documented clean in
    // curl.se/docs/vuln-8.20.0.html and so resolves the cumulative backlog of
    // every earlier advisory regardless of which point release first patched
    // it. Per-cycle verification: diff this roster against the version-tagged
    // entries on curl.se/docs/security.html each currency check.
    minVersion: ">=8.20.0",
    securityNote:
      "Upgrade to curl 8.20.0 (released 2026-04-29) or later — that build is documented clean in curl.se/docs/vuln-8.20.0.html and clears the cumulative advisory backlog of every earlier release, not only the issues first patched in 8.20.0. The three advisories specific to the 8.20.0 release are CVE-2026-5773, CVE-2026-5545, and CVE-2026-4873; earlier builds additionally carry a High-severity advisory (CVE-2026-6253) plus credential-leak and connection-reuse issues fixed across 8.17.0-8.19.0. Upgrade before using curl against authenticated endpoints over untrusted networks; check curl.se/docs/security.html for the current per-version roster.",
    homepage: "https://curl.se/",
    sourceRepo: "https://github.com/curl/curl",
    license: "curl",
  },

  // ── Tier 2 (13 tools, conditional) ──────────────────────────────
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
    // Cycle 11 D21-4 (SA21.6-F1): playwright was the only tier-2 browser tool
    // with no version floor while the skill recommends its sandbox image for
    // navigating untrusted URLs. CVE-2025-59288 (CVSS 8.7) is an installer
    // man-in-the-middle in `npx playwright install` (browser binaries fetched
    // without integrity verification) fixed in 1.55.1; the floor clears it.
    // The bundled Chromium also carries CVE-2026-2441 (CSS use-after-free RCE);
    // each monthly playwright release rolls a patched Chromium, so keeping the
    // install current — not just at the floor — matters for the browser engine.
    minVersion: ">=1.55.1",
    // playwright ships ~monthly point releases pinned to a Chromium roll, so a
    // long gap is itself a currency signal (an un-rolled Chromium accrues
    // browser-engine CVEs) — keep the install current, not just at the floor.
    securityNote:
      "CVE-2025-59288 (CVSS 8.7): `npx playwright install` in versions before 1.55.1 fetched browser binaries without integrity verification, allowing an installer man-in-the-middle to substitute a malicious browser build. Upgrade to >=1.55.1. The bundled Chromium also carries CVE-2026-2441 (CSS use-after-free RCE); each monthly playwright release rolls a patched Chromium, so track a current release and pin the sandbox container image to a current `*-noble` tag (not an 18-month-stale tag) when navigating untrusted URLs.",
    homepage: "https://playwright.dev/",
    sourceRepo: "https://github.com/microsoft/playwright",
    license: "Apache-2.0",
  },
  httpie: {
    id: "httpie",
    probe: "http",
    description: "Human-friendly HTTP/S client with intuitive UI, JSON output, syntax highlighting, and session management",
    category: "http",
    tier: 2,
    trigger: "web-project",
    install: {
      mac: [{ manager: "brew", command: "brew install httpie" }],
      linux: [{ manager: "snap", command: "sudo snap install httpie" }],
      win: [{ manager: "pipx", command: "pipx install httpie" }],
    },
    // Cycle 11 D21-15 (SA21.4-F3) — TRACKING (zero-commit watch): httpie/cli
    // last published 3.2.4 on 2024-11-01 (581 days at the 2026-06 audit) and
    // the GitHub commit API returned ZERO commits across 2025-01..2026-06 — the
    // repo is dormant, not merely slow-cadence. A dormant-but-not-archived tool
    // is not yet abandoned, so it stays registered. RE-CHECK TRIGGER for the
    // next D21 cycle: if the commit API is still empty (>2 years dormant) OR the
    // repo is archived, re-evaluate whether xh (the actively-maintained Rust
    // HTTPie-compatible client, already registered) should become the primary
    // web-project HTTP recommendation over httpie.
    // CVE-2023-48052 (GHSA-8r96-8889-qg2x) + CVE-2019-10751 (GHSA-xjjg-vmw6-c2p9) — both fixed by httpie 3.2.3
    minVersion: ">=3.2.3",
    homepage: "https://httpie.io/",
    sourceRepo: "https://github.com/httpie/cli",
    license: "BSD-3-Clause",
  },
  xh: {
    id: "xh",
    probe: "xh",
    description: "Fast Rust HTTP/S client with HTTPie-compatible syntax — HTTP/2 + HTTP/3 support, single-binary install",
    category: "http",
    tier: 2,
    trigger: "web-project",
    install: {
      mac: [{ manager: "brew", command: "brew install xh" }],
      linux: [{ manager: "cargo", command: "cargo install xh --locked" }],
      // Cycle 10 D21-SA21.4-F07: Windows lists winget (ducaale.xh) first as the
      // signed first-party channel, with cargo as the fallback for machines
      // without winget so Windows users are not forced onto a Rust-toolchain-
      // only path. Mirrors the delta / ast-grep multi-channel Windows precedent.
      win: [
        { manager: "winget", command: "winget install ducaale.xh" },
        { manager: "cargo", command: "cargo install xh --locked" },
      ],
    },
    // Cycle 10 D21-SA21.4-F04: xh v0.25.3 (2025-12-16) — 162 days at audit,
    // mid-Medium-band per D21 currency check (90-180 days). Cadence is roughly
    // quarterly per release history (v0.24.0 Feb 2025, v0.24.1 May 2025,
    // v0.25.0 Sep 2025, v0.25.3 Dec 2025). minVersion floors at the latest
    // stable so Windows / Linux installs upgrade past any earlier 0.24.x build.
    minVersion: ">=0.25.3",
    homepage: "https://github.com/ducaale/xh",
    sourceRepo: "https://github.com/ducaale/xh",
    license: "MIT",
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
    // Cycle 10 D15-SA15.7-F (F15.7-H7): the linux recipe pipes
    // install.duckdb.org straight to sh with no signature or checksum gate, so
    // a CDN compromise or DNS hijack would execute attacker code. brew (mac)
    // and winget (win) are signed channels and should be preferred.
    securityNote:
      "Unsigned install channel: the linux `curl https://install.duckdb.org | sh` recipe has no signature or checksum verification — a CDN compromise or DNS hijack would run attacker code. Prefer the signed brew (mac) / winget (win) channels, or download the release binary and verify its published SHA-256 from https://github.com/duckdb/duckdb/releases before executing.",
    homepage: "https://duckdb.org/",
    sourceRepo: "https://github.com/duckdb/duckdb",
    license: "MIT",
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
    sourceRepo: "https://github.com/jqnatividad/qsv",
    license: "MIT OR Unlicense",
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
    sourceRepo: "https://github.com/tamasfe/taplo",
    license: "MIT",
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
      // Cycle 11 D21-17 (SA21.5-F4): glab is only in the Ubuntu universe pocket
      // from 24.04+, so bare `sudo apt install glab` is absent on stock Debian
      // and on older Ubuntu, and distro builds lag the registry floor. snap is
      // the upstream-recommended Linux channel (snapcraft.io/glab) and tracks
      // current releases; the release `.deb` from gitlab.com/gitlab-org/cli is
      // the fallback when snapd is unavailable.
      linux: [{ manager: "snap", command: "sudo snap install glab" }],
      win: [{ manager: "winget", command: "winget install GitLab.GLab" }],
    },
    requiresEnv: ["GITLAB_TOKEN"],
    // Cycle 10 D21-SA21.5-F-21.5.3: tested-against version per D21 checklist
    // row 6 (documentation pin, not a CVE-driven floor) — Cycle 10 verified
    // glab 1.99.0 (2026-05-20). The installer surfaces this as advisory text.
    minVersion: "1.99.0",
    // Cycle 10 D21-SA21.5-F-21.5.2: glab ships at rapid cadence (~6-day mean,
    // 11 releases across 2026-03-23 → 2026-05-20), so a multi-week pause is
    // itself a currency signal worth re-checking each D21 cycle, and the
    // documentation pin above drifts quickly by construction.
    homepage: "https://gitlab.com/gitlab-org/cli",
    sourceRepo: "https://gitlab.com/gitlab-org/cli",
    license: "MIT",
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
    // Cycle 10 D21-SA21.5-F-21.5.3: tested-against version per D21 checklist
    // row 6 (documentation pin, not a CVE-driven floor) — Cycle 10 verified
    // az-devops 1.0.4 (release tag 20260514.1, 2026-05-15). The az-devops
    // extension version floats under `az extension update`; this records the
    // verified baseline for next-cycle drift measurement.
    minVersion: "1.0.4",
    // Cycle 10 D21-M6: the base `command -v az` probe resolves whenever Azure
    // CLI is on PATH, even if the azure-devops extension is missing — a false
    // positive for users who install `azure-cli` standalone (e.g. via apt
    // packages.microsoft.com) without the follow-up `az extension add`. The
    // extension probe runs `az extension list -o tsv` after the base probe
    // succeeds and only reports installed when "azure-devops" appears in the
    // extension roster. Args are character-allowlisted in detect.ts to stay
    // shell-injection-safe.
    extensionProbe: {
      args: ["extension", "list", "-o", "tsv"],
      expectInStdout: "azure-devops",
      name: "azure-devops",
    },
    // Cycle 10 D15-SA15.7-F (F15.7-H7): the linux recipe pipes the aka.ms
    // redirect to `sudo bash` — root execution with no signature or checksum
    // gate (highest blast radius of the unsigned recipes). Microsoft also
    // publishes a signed apt repo (packages.microsoft.com, signed-by key).
    securityNote:
      "Unsigned install channel (runs as root): the linux `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash` recipe executes a redirected script as root with no signature or checksum verification. Prefer Microsoft's signed apt repository per https://learn.microsoft.com/cli/azure/install-azure-cli-linux (adds packages.microsoft.com with a signed-by GPG key), or the signed winget (win) / brew (mac) channels.",
    homepage: "https://learn.microsoft.com/en-us/cli/azure/azure-devops",
    sourceRepo: "https://github.com/Azure/azure-devops-cli-extension",
    license: "MIT",
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
    // Cycle 10 D21-SA21.6-F02 (F21.6.F02): the 2026-05-18 Docker security
    // announcement disclosed three host-root `docker cp` escape paths fixed
    // in 29.5.1 — CVE-2026-41567 (PATH-resolved decompression binaries run as
    // host root), CVE-2026-41568 (TOCTOU host file/dir creation), and
    // CVE-2026-42306 (TOCTOU bind-mount redirection). 29.5.1 introduced a
    // `docker cp` regression ("mkdirat: file exists") that 29.5.2 (2026-05-20)
    // fixes, so the floor is raised to >=29.5.2 — the first build that is both
    // patched and regression-free per docs.docker.com/engine/release-notes/29.
    minVersion: ">=29.5.2",
    securityNote:
      "CVE-2026-32288: Docker engine before 29.5.0 is vulnerable to a denial-of-service via a crafted image manifest. CVE-2026-34040 (GHSA-x744-4wpc-v9h2, HIGH/8.8) and CVE-2026-33997 are AuthZ-bypass vulnerabilities in Docker Engine 29.x, both fixed in 29.3.1 (below the pinned floor; OSV serves CVE-2026-34040 as Go record GO-2026-4887 without a numeric severity, so the CLI CVE gate surfaces it under 'unscored advisories — manual review' rather than as a scored HIGH). CVE-2026-41567 / CVE-2026-41568 / CVE-2026-42306 (Docker Engine <=29.5.0): docker cp can be coerced to execute container binaries as host root or write to arbitrary host paths via TOCTOU on bind mounts (fixed in 29.5.1; 29.5.2 fixes the 29.5.1 docker cp regression). Upgrade to 29.5.2 or later before pulling images from untrusted registries or invoking docker cp on untrusted container filesystems. Unsigned install channel (runs as root): the linux `curl -fsSL https://get.docker.com | sudo sh` recipe has no signature or checksum gate — prefer Docker's signed apt repository per https://docs.docker.com/engine/install/ubuntu/ (adds download.docker.com with a signed-by GPG key) or the signed brew (mac) / winget (win) channels.",
    homepage: "https://docs.docker.com/get-docker/",
    sourceRepo: "https://github.com/moby/moby",
    license: "Apache-2.0",
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
    // Cycle 11 D15-SA15.7-F3: `llm --functions` executes arbitrary Python by
    // design (GHSA-g76p-4vg5-f4qh, CRITICAL code-injection with no upstream
    // fix). An autonomous agent will not independently know the flag runs
    // arbitrary code, so the caution is surfaced here (the standalone-skill
    // renderer + installer emit `securityNote`) instead of living only in a
    // maintainer-only CI script. OSV lists no upstream fix; the CLI CVE gate
    // acknowledges this advisory (ACKNOWLEDGED_ADVISORIES + VACUOUS_ACK) so it
    // is reported, never gating.
    securityNote:
      "GHSA-g76p-4vg5-f4qh (CRITICAL, by-design): `llm --functions` executes arbitrary Python supplied on the command line — never pass untrusted or agent-fetched content (file contents, web responses, tool output) to `llm --functions`. There is no upstream fix; the flag is intended for trusted, user-authored code only. Plain prompting (`llm -t <template>`, `llm < file`) does not execute code and is unaffected.",
    homepage: "https://llm.datasette.io/",
    sourceRepo: "https://github.com/simonw/llm",
    license: "Apache-2.0",
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
    sourceRepo: "https://github.com/junegunn/fzf",
    license: "MIT",
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
    sourceRepo: "https://github.com/jesseduffield/lazygit",
    license: "MIT",
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
    sourceRepo: "https://github.com/Wilfred/difftastic",
    license: "MIT",
  },

  // ── Tier 3 (10 tools, opt-in advanced) ──────────────────────────
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
    // Cycle 10 D15-SA15.7-F (F15.7-H7): the linux recipe pipes rtk.dev to sh
    // with no signature or checksum gate; rtk publishes no signed apt/dnf
    // channel, so the signed brew (mac) / scoop (win) manifests are the only
    // verified paths.
    securityNote:
      "Unsigned install channel: the linux `curl -fsSL https://rtk.dev/install.sh | sh` recipe has no signature or checksum verification, and rtk ships no signed Linux package repository. Prefer the signed brew (mac) / scoop (win) channels, or on Linux download the release asset and verify its SHA-256 against the checksum published at https://github.com/rtk-ai/rtk/releases before executing.",
    homepage: "https://github.com/rtk-ai/rtk",
    sourceRepo: "https://github.com/rtk-ai/rtk",
    license: "Apache-2.0",
  },
  stagehand: {
    id: "stagehand",
    probe: "stagehand",
    description: "Browserbase Stagehand — AI-driven browser automation",
    category: "browser",
    tier: 3,
    caveat: "browser-driver-peer-dep-trust",
    install: {
      mac: [{ manager: "npm", command: "npm install -g @browserbasehq/stagehand" }],
      linux: [{ manager: "npm", command: "npm install -g @browserbasehq/stagehand" }],
      win: [{ manager: "npm", command: "npm install -g @browserbasehq/stagehand" }],
    },
    // Cycle 10 D15-SA15.7-F-15.7-08: Stagehand selects one of three browser-
    // driver peer deps — `playwright-core` (Microsoft) and `puppeteer-core`
    // (Google) are vendor-maintained, but `patchright-core` is a community
    // detection-bypass fork with a different vetting profile. The peer-dep
    // choice influences browser-sandbox supply-chain trust, so the entry
    // carries this securityNote like the tier-3 rtk caveat precedent.
    securityNote:
      "Browser-driver peer-dep trust: Stagehand runs against one of playwright-core (Microsoft), puppeteer-core (Google), or patchright-core (community fork). Prefer playwright-core as the default — patchright-core is a less-vetted community detection-bypass fork with a different supply-chain trust profile than the vendor-maintained drivers. Install only the driver you need and pin it.",
    homepage: "https://github.com/browserbase/stagehand",
    sourceRepo: "https://github.com/browserbase/stagehand",
    license: "MIT",
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
    sourceRepo: "https://github.com/sigoden/aichat",
    license: "MIT OR Apache-2.0",
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
    sourceRepo: "https://github.com/charmbracelet/mods",
    license: "MIT",
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
    // Cycle 10 D15-SA15.7-F (F15.7-H7): the linux recipe runs
    // `bash <(curl -sL get.comby.dev)` — process-substitution execution with
    // no signature or checksum gate. comby ships no signed Linux package
    // repository, so the signed brew (mac) / scoop (win) manifests are the
    // only verified paths.
    securityNote:
      "Unsigned install channel: the linux `bash <(curl -sL get.comby.dev)` recipe executes a fetched script with no signature or checksum verification, and comby ships no signed Linux package repository. Prefer the signed brew (mac) / scoop (win) channels, or on Linux download the release binary and verify its SHA-256 against the checksum published at https://github.com/comby-tools/comby/releases before executing.",
    homepage: "https://comby.dev/",
    sourceRepo: "https://github.com/comby-tools/comby",
    license: "Apache-2.0",
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
    // Cycle 11 D21-13 (SA21.3-F5): tested-against version per the D21
    // documentation-pin precedent (glab 1.99.0 / az-devops 1.0.4) — NOT a
    // CVE-driven floor. Cycle 11 verified miller v6.18.1 (2026-04-19). The
    // installer surfaces this as advisory text; next cycle measures drift.
    minVersion: "6.18.1",
    homepage: "https://miller.readthedocs.io/",
    sourceRepo: "https://github.com/johnkerl/miller",
    license: "BSD-2-Clause",
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
    // Cycle 11 D21-13 (SA21.3-F5): tested-against version per the D21
    // documentation-pin precedent (glab 1.99.0 / az-devops 1.0.4) — NOT a
    // CVE-driven floor. Cycle 11 verified csvkit 2.2.0. The installer surfaces
    // this as advisory text; next cycle measures drift against it.
    minVersion: "2.2.0",
    homepage: "https://csvkit.readthedocs.io/",
    sourceRepo: "https://github.com/wireservice/csvkit",
    license: "MIT",
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
      "CVE-2026-33414 (Windows only): Podman before 5.8.2 is vulnerable to PowerShell command injection in `podman machine init --image` on the Hyper-V backend, allowing Hyper-V VM escape. Upgrade to 5.8.2 or later on Windows; mac and linux builds are unaffected. CVE-2024-3056 (GHSA-rpcc-p8xm-rc6p, Pasta DNS resolver) and CVE-2025-4953 (GHSA-m68q-4hqr-mc6f, memory corruption in netavark) are served by OSV as Go records without a numeric severity, so the CLI CVE gate surfaces them under 'unscored advisories — manual review' rather than as scored findings — both are fixed at or below the pinned 5.8.2 floor.",
    homepage: "https://podman.io/",
    sourceRepo: "https://github.com/containers/podman",
    license: "Apache-2.0",
  },
  dasel: {
    id: "dasel",
    probe: "dasel",
    description: "Cross-format selector — JSON / YAML / TOML / XML / CSV under one path-query DSL",
    category: "data",
    tier: 3,
    install: {
      mac: [{ manager: "brew", command: "brew install dasel" }],
      linux: [{ manager: "go", command: "go install github.com/tomwright/dasel/v3/cmd/dasel@latest" }],
      win: [{ manager: "scoop", command: "scoop install dasel" }],
    },
    // Cycle 11 D21-11 (SA21.3-F2): the prior note said all 3 CVEs were "fixed
    // in v3.11.0" — wrong. Per the upstream security tab (credited to researcher
    // kq5y), the fixes landed at DIFFERENT versions: GHSA-4fcp-jxh7-23x8
    // (CVE-2026-33320, Moderate, YAML alias expansion DoS) fixed in 3.3.2;
    // GHSA-m6xr-fvfg-5g64 (CVE-2026-46378, High, selector-lexer DoS) fixed in
    // 3.10.1; GHSA-m5j3-4634-c2vq (CVE-2026-46377, High, index-out-of-range
    // panic) fixed in 3.10.1. The recommended floor stays at >=3.11.0 because
    // 3.11.0 > 3.10.1 > 3.3.2 clears all three plus is the documented current
    // stable (2026-05-19), so pinning it covers the cluster regardless of the
    // per-CVE landing release.
    minVersion: ">=3.11.0",
    securityNote:
      "dasel CVEs (per-CVE fix versions): CVE-2026-33320 (Moderate, unbounded YAML alias-expansion DoS) fixed in 3.3.2; CVE-2026-46378 (High, selector-lexer DoS) and CVE-2026-46377 (High, index-out-of-range panic) fixed in 3.10.1. Pin >=3.11.0 — the current stable — which clears all three. Avoid running dasel on untrusted input on any earlier build.",
    homepage: "https://github.com/TomWright/dasel",
    sourceRepo: "https://github.com/TomWright/dasel",
    license: "MIT",
  },
  "container-use": {
    id: "container-use",
    probe: "container-use",
    description: "Dagger sandbox runtime for agentic coding environments (pre-1.0; see caveat)",
    category: "container",
    tier: 3,
    caveat: "pre-1.0-stale-no-security-policy",
    install: {
      mac: [{ manager: "brew", command: "brew install dagger/tap/container-use" }],
      linux: [{ manager: "curl", command: "curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash" }],
      win: [{ manager: "curl", command: "curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash" }],
    },
    // Cycle 10 D21-SA21.6-F03/F07 (F-21.7.1): dagger/container-use v0.4.2
    // shipped 2025-08-19 — 281 days at audit. Upstream README flags
    // "in early development and actively evolving"; no SECURITY.md is
    // published. D15 sandbox-escape control references container-use
    // alongside playwright and docker, so the catalog needs an entry
    // even though the tool is pre-1.0; the `pre-1.0-stale-no-security-policy`
    // caveat keeps the unresolved-staleness state visible to consumers, and
    // D21 should re-check upstream tagging each cycle.
    // Cycle 10 D15-SA15.7-F (F15.7-H7): both the linux and win recipes pipe
    // the raw.githubusercontent.com install script to bash with no signature
    // or checksum gate; upstream publishes no signed package channel and no
    // SECURITY.md (see caveat), so brew (mac) is the only signed path.
    minVersion: ">=0.4.2",
    securityNote:
      "Unsigned install channel: the linux and win recipes pipe `raw.githubusercontent.com/dagger/container-use/main/install.sh` to bash with no signature or checksum verification, and the pre-1.0 project publishes no signed package channel. Prefer the signed brew (mac) channel, or pin the install script to a tagged commit SHA and verify the downloaded binary's SHA-256 against the asset checksum at https://github.com/dagger/container-use/releases before executing.",
    homepage: "https://github.com/dagger/container-use",
    sourceRepo: "https://github.com/dagger/container-use",
    license: "Apache-2.0",
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
  "curl",
] as const;

/**
 * Tier-2 tools grouped by their trigger condition (see plan §3). Each
 * trigger maps to the list of tools the picker pre-checks when the
 * condition holds for the active `RepoInfo`/`Platform`.
 */
export const TIER2_CLI_TOOLS_BY_TRIGGER: Readonly<Record<Tier2Trigger, readonly CliToolId[]>> = {
  "web-project": ["playwright", "httpie", "xh"],
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
  "dasel",
  "container-use",
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
