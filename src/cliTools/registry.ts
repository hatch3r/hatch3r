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
    // Cycle 10 D21-M1: ripgrep 15.1.0 (released 2025-10-31) is 208 days old at
    // the 2026-05-26 audit. BurntSushi/ripgrep is mature steady-state — the
    // 14.x → 15.x cadence shows multi-month gaps as normal (14.0 Aug 2023,
    // 14.1 Sep 2023, 14.1.1 Apr 2024, 15.0 Oct 2024, 15.1 Oct 2025). Tagged
    // `stable` so src/cliTools/triggers.ts staleness heuristic suppresses
    // amber-flag noise for the long gap; the tool is the canonical search
    // primitive across hatch3r-cli-* skills and not at risk of abandonment.
    releaseCadence: "stable",
    // CVE-2021-3013 (GHSA-g4xg-fxmg-vcg5) OS command injection — fixed in ripgrep 13.0.0
    minVersion: ">=13.0.0",
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
    // 7 releases across 2025-06 → 2026-04). Tagged `rapid` so a cadence-aware
    // staleness heuristic treats a 45-day pause as an anomaly rather than
    // waiting for the default 90/180-day window.
    releaseCadence: "rapid",
    securityNote:
      "CVE-2026-48501 / GHSA-8xvp-7hj6-mcj9: gh CLI 2.92.0 and earlier attach the Authorization header (github.com token, or GH_ENTERPRISE_TOKEN / GITHUB_ENTERPRISE_TOKEN) to TUF repository-mirror requests made by `gh attestation`, `gh release verify`, and `gh release verify-asset` — leaking the token to hosts such as tuf-repo.github.com / tuf-repo-cdn.sigstore.dev. Fixed in 2.93.0; upgrade before running attestation or release-verify commands. (Separately, CVE-2026-45803 / GHSA-crc3-h8v6-qh57 is a LOW terminal-escape-sequence injection in `gh run view --log`, fixed 2.92.0.)",
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
    // CVE-2021-36376 (GHSA-5xg3-j2j6-rcx4) path traversal — fixed in git-delta 0.8.3
    minVersion: ">=0.8.3",
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
    // Cycle 10 D21-M3: bat 0.26.1 (released 2025-12-12) is 167 days old at the
    // 2026-05-26 audit. sharkdp/bat shares the same author + cadence pattern
    // as fd — mature steady-state tooling with multi-month gaps between
    // minor releases (0.24 Mar 2024, 0.25 Mar 2025, 0.26 Dec 2025). Tag
    // `stable` so the staleness heuristic stops auto-flagging the long gap
    // as abandonment; bat is the canonical syntax-aware view tool in
    // hatch3r-cli-toolbox and remains under active maintenance.
    releaseCadence: "stable",
    // CVE-2021-36753 (GHSA-p24j-h477-76q3) uncontrolled search path — fixed in bat 0.18.2
    minVersion: ">=0.18.2",
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
    // Cycle 9 D21-SA21.2-F01: sd 1.1.0 (released 2025-02-24) was 447 days old
    // at the 2026-05-18 audit. The chmln/sd project is mature steady-state —
    // long gaps between minor releases are intentional, not abandonment.
    // Tagged `stable` so the staleness heuristic stops flagging this entry.
    releaseCadence: "stable",
    // Cycle 11 D21-6 (SA21.2-F1): floored at >=1.1.0 now that all three OS
    // channels (brew, scoop, cargo binstall from the v1.1.0 GitHub release)
    // can satisfy it — the documented line-by-line default + `-A`/`--across`
    // flag are 1.1.0 features absent from the crates.io 1.0.0 build.
    minVersion: ">=1.1.0",
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
    // Cycle 10 D21-SA21.1-F-21.1.2: ast-grep ships at rapid cadence — five
    // tags in 71 days at audit (0.42.0 2026-03-16, 0.42.1 2026-04-04,
    // 0.42.2 2026-05-10, 0.42.3 2026-05-19, 0.43.0 2026-05-25; ~14-day mean).
    // Tagged `rapid` so a cadence-aware staleness heuristic can treat a short
    // pause (e.g. 45 days) as a stronger anomaly than the default 180-day gate.
    releaseCadence: "rapid",
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
    // Cycle 10 D21-SA21.4-F02: curl 8.20.0 (released 2026-04-29) supersedes
    // a seven-CVE batch disclosed Mar-Apr 2026 — five Medium credential-leak
    // and connection-reuse advisories plus two SMB / netrc redirect issues —
    // affecting versions 7.12.0 through 8.19.0. The fix version 8.20.0 is
    // documented clean in curl.se/docs/vuln-8.20.0.html.
    minVersion: ">=8.20.0",
    securityNote:
      "CVE-2026-7168 / 7009 / 6429 / 6253 / 6276 / 3805 / 3783: curl <8.20.0 carries seven Medium-and-Low credential-leak and connection-reuse vulnerabilities (cross-proxy Digest leak, OCSP stapling bypass, netrc credential leak, redirect-to-proxy credential leak, stale-cookie leak, SMB use-after-free, netrc token leakage on redirect). Upgrade to 8.20.0 (released 2026-04-29) before using curl against authenticated endpoints over untrusted networks.",
    homepage: "https://curl.se/",
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
    // long gap is itself a staleness signal (an un-rolled Chromium accrues
    // browser-engine CVEs). Tagged `monthly` rather than `stable`.
    releaseCadence: "monthly",
    securityNote:
      "CVE-2025-59288 (CVSS 8.7): `npx playwright install` in versions before 1.55.1 fetched browser binaries without integrity verification, allowing an installer man-in-the-middle to substitute a malicious browser build. Upgrade to >=1.55.1. The bundled Chromium also carries CVE-2026-2441 (CSS use-after-free RCE); each monthly playwright release rolls a patched Chromium, so track a current release and pin the sandbox container image to a current `*-noble` tag (not an 18-month-stale tag) when navigating untrusted URLs.",
    homepage: "https://playwright.dev/",
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
    // Cycle 10 D21-SA21.4-F03: httpie/cli last published 3.2.4 on 2024-11-01
    // (572 days at audit). Project still under maintenance — 3.2.4 itself was
    // a certificate-loading fix — but cadence has slowed. Tag stable so the
    // staleness heuristic does not auto-flag the long gap as abandonment.
    releaseCadence: "stable",
    // CVE-2023-48052 (GHSA-8r96-8889-qg2x) + CVE-2019-10751 (GHSA-xjjg-vmw6-c2p9) — both fixed by httpie 3.2.3
    minVersion: ">=3.2.3",
    homepage: "https://httpie.io/",
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
    releaseCadence: "quarterly",
    homepage: "https://github.com/ducaale/xh",
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
    // Cycle 10 D21-SA21.5-F-21.5.3: tested-against version per D21 checklist
    // row 6 (documentation pin, not a CVE-driven floor) — Cycle 10 verified
    // glab 1.99.0 (2026-05-20). The installer surfaces this as advisory text.
    minVersion: "1.99.0",
    // Cycle 10 D21-SA21.5-F-21.5.2: glab ships at rapid cadence (~6-day mean,
    // 11 releases across 2026-03-23 → 2026-05-20). Tagged `rapid` so a
    // cadence-aware staleness heuristic treats a short pause as an anomaly.
    releaseCadence: "rapid",
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
      "CVE-2026-32288: Docker engine before 29.5.0 is vulnerable to a denial-of-service via a crafted image manifest. CVE-2026-34040 (GHSA-x744-4wpc-v9h2, HIGH/8.8 authorization-bypass; OSV serves this as Go record GO-2026-4887 without a numeric severity, so the CLI CVE gate surfaces it under 'unscored advisories — manual review' rather than as a scored HIGH). CVE-2026-41567 / CVE-2026-41568 / CVE-2026-42306 (Docker Engine <=29.5.0): docker cp can be coerced to execute container binaries as host root or write to arbitrary host paths via TOCTOU on bind mounts (fixed in 29.5.1; 29.5.2 fixes the 29.5.1 docker cp regression). Upgrade to 29.5.2 or later before pulling images from untrusted registries or invoking docker cp on untrusted container filesystems. Unsigned install channel (runs as root): the linux `curl -fsSL https://get.docker.com | sudo sh` recipe has no signature or checksum gate — prefer Docker's signed apt repository per https://docs.docker.com/engine/install/ubuntu/ (adds download.docker.com with a signed-by GPG key) or the signed brew (mac) / winget (win) channels.",
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
    // Cycle 10 D15-SA15.7-F (F15.7-H7): the linux recipe runs
    // `bash <(curl -sL get.comby.dev)` — process-substitution execution with
    // no signature or checksum gate. comby ships no signed Linux package
    // repository, so the signed brew (mac) / scoop (win) manifests are the
    // only verified paths.
    securityNote:
      "Unsigned install channel: the linux `bash <(curl -sL get.comby.dev)` recipe executes a fetched script with no signature or checksum verification, and comby ships no signed Linux package repository. Prefer the signed brew (mac) / scoop (win) channels, or on Linux download the release binary and verify its SHA-256 against the checksum published at https://github.com/comby-tools/comby/releases before executing.",
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
      "CVE-2026-33414 (Windows only): Podman before 5.8.2 is vulnerable to PowerShell command injection in `podman machine init --image` on the Hyper-V backend, allowing Hyper-V VM escape. Upgrade to 5.8.2 or later on Windows; mac and linux builds are unaffected. CVE-2024-3056 (GHSA-rpcc-p8xm-rc6p, Pasta DNS resolver) and CVE-2025-4953 (GHSA-m68q-4hqr-mc6f, memory corruption in netavark) are served by OSV as Go records without a numeric severity, so the CLI CVE gate surfaces them under 'unscored advisories — manual review' rather than as scored findings — both are fixed at or below the pinned 5.8.2 floor.",
    homepage: "https://podman.io/",
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
    // Cycle 10 D21-SA21.3-F-21.3.5/F-21.3.6 (F-21.7.1): dasel v3.11.0
    // (2026-05-19) closes a 3-CVE cluster credited to researcher kq5y on
    // the upstream security tab — GHSA-m6xr-fvfg-5g64 (CVE-2026-46378,
    // High, selector-lexer DoS), GHSA-m5j3-4634-c2vq (CVE-2026-46377,
    // High, index-out-of-range panic), GHSA-4fcp-jxh7-23x8
    // (CVE-2026-33320, Moderate, YAML alias expansion DoS).
    minVersion: ">=3.11.0",
    securityNote:
      "CVE-2026-46377 / CVE-2026-46378 / CVE-2026-33320 (all fixed in v3.11.0): dasel before 3.11.0 has selector-lexer DoS and panic vulnerabilities on attacker-controlled input plus an unbounded YAML alias-expansion DoS. Avoid running dasel on untrusted input until upgraded to 3.11.0 or later.",
    homepage: "https://github.com/TomWright/dasel",
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
    // even though the tool is pre-1.0. releaseCadence intentionally NOT
    // "stable" so the staleness heuristic keeps emitting amber flags
    // until upstream resumes tagging.
    // Cycle 10 D15-SA15.7-F (F15.7-H7): both the linux and win recipes pipe
    // the raw.githubusercontent.com install script to bash with no signature
    // or checksum gate; upstream publishes no signed package channel and no
    // SECURITY.md (see caveat), so brew (mac) is the only signed path.
    minVersion: ">=0.4.2",
    releaseCadence: "quarterly",
    securityNote:
      "Unsigned install channel: the linux and win recipes pipe `raw.githubusercontent.com/dagger/container-use/main/install.sh` to bash with no signature or checksum verification, and the pre-1.0 project publishes no signed package channel. Prefer the signed brew (mac) channel, or pin the install script to a tagged commit SHA and verify the downloaded binary's SHA-256 against the asset checksum at https://github.com/dagger/container-use/releases before executing.",
    homepage: "https://github.com/dagger/container-use",
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
