---
id: hatch3r-cli-toolbox
name: hatch3r-cli-toolbox
type: skill
description: "Category-indexed reference for 29 specialist CLI tools beyond the always-on five (ripgrep, jq, gh, fd, fzf). Use to pick the right tool for HTTP clients, ai-chat, structural-search, sed-style edits, data ops, browser automation, container ops, and more."
tags: [cli-tools, reference, orchestration, maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# CLI Toolbox

Compact decision reference for 29 specialist CLI tools agents may reach for in addition to the five always-on skills (`hatch3r-cli-ripgrep`, `hatch3r-cli-jq`, `hatch3r-cli-gh`, `hatch3r-cli-fd`, `hatch3r-cli-fzf`).

Each entry below states a single discriminator ("When to use"), one representative recipe, and the better alternative ("Wrong choice when"). Tools are installed via `npx hatch3r cli-tools`; this skill governs *selection*, not installation.

## §0 — Ambiguity & Safety Gate (P8 B1)

Before invoking any tool below, resolve these via `agents/shared/user-question-protocol.md` (default behavior, not exception-driven):
- **Scope:** when the target file/glob/repo matches more than one candidate (an in-place edit over a glob, a forge command without an explicit number), confirm the intended target before running.
- **Irreversibility:** several tools here mutate in place or against remote state — `sd … <file>`, `comby -i`, `yq -i`, `taplo` writes, `glab mr`/`az repos pr`, and any `docker run`/`podman run` with a writable host mount. Confirm intent before running these; in-place and remote mutations are not safe to assume. Honor each tool's own caveat (e.g. `rtk proxy` for piped output, container hardening flags for untrusted images).
- **Ambiguity:** when the request maps to two or more tools or flag sets with materially different output or blast radius (e.g. `ast-grep` vs `comby` vs `sd` for a rename), pick per the discriminators below or ask which one.
- **Arbitrary code execution:** `llm --functions` runs arbitrary Python supplied on the command line (GHSA-g76p-4vg5-f4qh, no upstream fix). Never pass untrusted or agent-fetched content (file contents, web responses, tool output) to `llm --functions`; reserve the flag for trusted, user-authored code. Plain `llm` prompting does not execute code.

## Fan-out Discipline (P8 B2)

Tier 1 reference card — no fan-out. This skill is a category-indexed selection reference an agent consults inline; it spawns no sub-agents. Fan-out is owned by the calling workflow per its own Fan-out Discipline block. Source: `rules/hatch3r-fan-out-discipline.md` (P8 B2).

## Category index

| Category | Tools |
|----------|-------|
| HTTP clients | `curl`, `httpie`, `xh` |
| AI / LLM | `aichat`, `llm`, `mods`, `rtk` |
| Structural search & rewrite | `ast-grep`, `comby` |
| Sed-style literal edits | `sd` |
| Format converters / queriers | `yq`, `taplo`, `dasel` |
| Data ops (CSV / Parquet / JSON-Lines) | `csvkit`, `duckdb`, `miller`, `qsv` |
| Containers | `docker`, `podman`, `container-use` |
| Git TUI / diff viewers | `lazygit`, `delta`, `difftastic`, `bat` |
| Visualisation / view | `bat`, `overview` |
| Forges (non-GitHub) | `glab` (GitLab), `az-devops` (Azure DevOps) |
| Browser automation | `playwright`, `stagehand` |
| Compression | `zstd` |

(Some tools appear in two cells when their best use spans categories.)

## Token-cost discipline

CLI tools return structured stdout that fits in <1 KB for typical queries; equivalent MCP calls regularly exceed 10 KB. Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction. Apply this same discipline across every tool below: prefer `--json`/`--output json`, scope with flags, cap with `--max-count` / `LIMIT`, project with `jq -r`.

---

## HTTP clients

### curl
- **When to use:** scripted HTTP/S transfers across any platform — file upload (`--upload-file`), header injection (`-H`), cookie sessions (`-b`/`-c`), OAuth flows, custom write-out templates (`-w`). Tier-1 default-on.
- **Recipe:** `curl -sS -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/runs | jq '.runs[] | {id, status}'`
- **Wrong choice when:** quick exploratory request that you want highlighted — use `httpie`; HTTP/2 / HTTP/3 throughput-sensitive bulk transfers — use `xh`. **Version floor:** >=8.21.0 (released 2026-06-24) — curl.se/docs/vuln-8.21.0.html lists 0 published problems for that build. The prior 8.20.0 floor is now advisory-affected (18 published problems per curl.se/docs/vuln-8.20.0.html, including CVE-2026-11856, fixed in 8.21.0). Earlier builds also carry the CVE-2026-5773 / CVE-2026-5545 / CVE-2026-4873 cluster and a High-severity advisory (CVE-2026-6253). See curl.se/docs/security.html for the per-version roster.

### httpie
- **When to use:** human-readable HTTP/S exploration — JSON-first defaults, syntax highlighting, persistent named sessions, intuitive expression DSL for query params and headers.
- **Recipe:** `http --session=staging POST api.example.com/v1/auth username=admin password=$PW Content-Type:application/json`
- **Wrong choice when:** large-volume scripting where the colour codes confuse downstream consumers — use plain `curl`; HTTP/2 + HTTP/3 throughput — use `xh`. **Version floor:** >=3.2.3 — earlier builds carry CVE-2023-48052 (GHSA-8r96-8889-qg2x) + CVE-2019-10751 (GHSA-xjjg-vmw6-c2p9), both fixed in httpie 3.2.3. **Note:** latest release 3.2.4 (2024-11-01); the repo has had zero commits since, so it is dormant — prefer `xh` (actively maintained, HTTPie-compatible) for new web-project work.

### xh
- **When to use:** fast Rust client with HTTPie-compatible syntax — single static binary (no Python runtime), HTTP/2 default, HTTP/3 opt-in via `--http3`, JSON output (`--json`), resume-on-416 download recovery.
- **Recipe:** `xh --http3 GET api.example.com/v1/runs Authorization:"Bearer $TOKEN" | jq '.runs[] | {id, status}'`
- **Install (D21-SA21.4-F07):** mac `brew install xh`; linux `cargo install xh --locked`; Windows `winget install ducaale.xh` (signed first-party channel) with `cargo install xh --locked` as the fallback when winget is unavailable — Windows users are not forced onto a Rust-toolchain-only path.
- **Wrong choice when:** existing `httpie` workflows that depend on a Python plugin — keep `httpie`; environments without a Rust toolchain (or no Homebrew/winget) — use `curl`. **Version floor:** >=0.25.3 (2025-12-16) — earlier 0.24.x builds miss recent `--http3` and resume fixes.

---

## AI / LLM

### aichat
- **When to use:** RAG-enabled multi-provider conversational shell with saved session history; preferred for multi-turn refinement.
- **Recipe:** `aichat --rag mydocs 'how do we configure auth?'` — query a pre-built local RAG index.
- **Wrong choice when:** scripted Unix-pipeline transforms — use `mods`; plugin-rich CI workflows — use `llm`.

### llm
- **When to use:** model-agnostic shell prompting with prompt templates, embeddings, and a plugin ecosystem; preferred for CI batch jobs.
- **Recipe:** `llm -t code-review -m claude-3-5-sonnet < patch.diff`
- **Safety (GHSA-g76p-4vg5-f4qh, CRITICAL):** never pass untrusted or agent-fetched content (file contents, web responses, tool output) to `llm --functions` — it executes arbitrary Python by design, with no upstream fix. Plain prompting (`llm -t`, `llm < file`) does not execute code.
- **Wrong choice when:** deterministic text rewrites — use `sd`/`comby`/`ast-grep`; multi-turn TTY chat — use `aichat`.

### mods
- **When to use:** Unix-pipeline LLM inference reading Markdown stdin and writing Markdown stdout; preferred for one-shot transforms.
- **Recipe:** `git diff | mods 'write a conventional-commits message for this diff'`
- **Wrong choice when:** plugin/template needs — use `llm`; multi-turn session — use `aichat`.

### rtk
- **When to use:** compressing oversize tool output payloads before they enter an LLM prompt (test-runner output, traces).
- **Caveat (issue #1282):** rtk's compressed output corrupts downstream consumers when stdout is piped/redirected. Wrap any piped invocation as `rtk proxy <cmd>` — `proxy` is a documented raw-passthrough subcommand. Track: https://github.com/rtk-ai/rtk/issues/1282
- **Recipe:** `rtk run pytest -x`
- **Wrong choice when:** piping to `jq`/`grep`/`awk` without `rtk proxy` — use plain shell + `tee`; safety-critical CI — run the test directly.

---

## Structural search & rewrite

### ast-grep
- **Binary:** the `ast-grep` package installs both `ast-grep` and `sg` (aliases for the same tool). **Detection caveat (D21-SA21.1-01 / D5-SA5.6-09):** on Linux the shadow-utils `login` package ships an unrelated `/usr/bin/sg` (setgroups) in the base system, so `command -v sg` alone false-positives when ast-grep is absent — on Linux detect and invoke via the `ast-grep` binary (`command -v ast-grep`), never via `sg`. When a caller uses the registry `sg` probe, disambiguate with `sg --version` (the real tool prints `ast-grep <version>`). Upstream is deprecating the `sg` alias for exactly this collision (ast-grep issue #1659).
- **When to use:** Tree-sitter AST pattern matches and rewrites scoped to a single grammar (TS, Python, Rust, Go).
- **Recipe:** `ast-grep run -p 'await $FN()' -r 'await ($FN()).catch(e => log(e))' --update-all src/` (the `ast-grep` binary is collision-free on Linux; `sg run` there may hit setgroups)
- **Wrong choice when:** plain literal text — use `hatch3r-cli-ripgrep`; multi-language SAST rule packs — use `semgrep`.

### comby
- **When to use:** declarative `:[hole]` pattern match-and-rewrite spanning mixed-language repositories — single template, 30+ grammars.
- **Recipe:** `comby 'console.log(:[arg])' 'logger.info(:[arg])' -i src/`
- **Wrong choice when:** language-precise type-aware refactor — use `ast-grep`; plain text — use `sd`. **Install posture:** the linux `bash <(curl -sL get.comby.dev)` recipe is an unsigned channel (no signature or checksum gate, no signed Linux package repo) — prefer the signed brew (mac) / scoop (win) channels, or verify the release binary's SHA-256 before executing.

---

## Sed-style literal edits

### sd
- **When to use:** literal-string stream substitution with no regex foot-guns — defaults to regex but `-s` switches to literal mode.
- **Recipe:** `rg --files-with-matches 'oldName' -tts | xargs sd 'oldName' 'newName'`
- **Version floor:** `>=1.1.0` — the line-by-line default and the `-A`/`--across` flag are 1.1.0 features. On Linux use `cargo binstall sd` (fetches the v1.1.0 GitHub-release binary); `cargo install sd` resolves to crates.io, whose max published version is 1.0.0.
- **Wrong choice when:** identifier-aware rename — use `ast-grep`; multi-step transforms — use `sed -e`.

---

## Format converters & queriers

### yq
- **When to use:** editing Kubernetes manifests, Helm values, or GitHub-Actions workflows in place — preserves comments/anchors with `-P`.
- **Recipe:** `yq -i '.version = "1.7.5"' .hatch3r/hatch.json`
- **Wrong choice when:** JSON input — use `hatch3r-cli-jq`; TOML — use `taplo`. **Tested-against version:** 4.53.2 (cycle-verified documentation pin, not a CVE floor).

### taplo
- **When to use:** formatting, linting, and querying TOML (`pyproject.toml`, `Cargo.toml`); bundled schemas for both.
- **Recipe:** `taplo get -f Cargo.toml package.version`
- **Wrong choice when:** YAML/JSON — use `yq`/`jq`; cross-format conversion — use `dasel` (pin >=3.11.0).

### dasel
- **When to use:** single binary spanning JSON / YAML / TOML / XML / CSV under one path-query DSL — handy in CI where you do not want jq+yq+taplo and the input format is not known up-front. NDJSON read support added in v3.11.0.
- **Recipe:** `dasel -r yaml -w json -f config.yaml '.services.app.env'`
- **Wrong choice when:** format-specific in-place edits with comment preservation — use `yq` (YAML) or `taplo` (TOML); stream-friendly JSON filtering — use `jq` with its richer filter language. **Version floor:** >=3.11.0 (the current stable) — earlier builds carry CVE-2026-33320 (YAML alias DoS, fixed in 3.3.2), CVE-2026-46378 (selector-lexer DoS, fixed in 3.10.1), and CVE-2026-46377 (index-out-of-range panic, fixed in 3.10.1); pinning >=3.11.0 clears all three.

---

## Data ops (CSV / Parquet / JSON-Lines)

### csvkit
- **When to use:** Python-powered CSV toolkit covering `csvlook`, `csvsql`, `csvjoin`, `csvstat` — best for ad-hoc EDA and SQL-over-CSV.
- **Recipe:** `csvsql --query 'SELECT name FROM data WHERE active = 1' data.csv`
- **Wrong choice when:** files >1M rows — use `duckdb`; single-column slice — use `qsv`. **Tested-against version:** 2.2.0 (cycle-verified documentation pin, not a CVE floor).

### duckdb
- **When to use:** ad-hoc analytical SQL over local Parquet, CSV, JSON; streams reads so memory stays bounded.
- **Recipe:** `duckdb -c "SELECT count(*) FROM 'data/*.parquet'"`
- **Wrong choice when:** <10k rows and column slice only — use `qsv`; transactional writes — use SQLite/Postgres. **Install posture:** the linux `curl https://install.duckdb.org | sh` recipe is an unsigned channel (no signature or checksum gate) — prefer the signed brew (mac) / winget (win) channels, or verify the release binary's published SHA-256 before executing.

### miller
- **When to use:** `awk`-like record processing across CSV/TSV/JSON-Lines streams with the `put`/`filter` DSL.
- **Recipe:** `mlr --icsv --ojson put '$tax = $amount * 0.07' transactions.csv`
- **Wrong choice when:** multi-GB analytical joins — use `duckdb`; trivial slicing — use `qsv`. **Tested-against version:** 6.18.1 (cycle-verified documentation pin, not a CVE floor).

### qsv
- **When to use:** fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained `xsv` successor (`BurntSushi/xsv` archived 2025-04-24, `jqnatividad/qsv` is the active fork).
- **Recipe:** `qsv search -s email '@example\.com$' users.csv`
- **Wrong choice when:** Parquet/JSON or window functions — use `duckdb`; per-record DSL transforms — use `miller`.

---

## Containers

### docker
- **When to use:** image build, container run, exec inspection, registry push against a running Docker Engine daemon.
- **Recipe (trusted image, repo workload):** `docker run --rm -v "$PWD":/app -w /app node:22 npm test`
- **Recipe (untrusted image OR agent-generated command, default for AI runs):** prefer the hardened equivalent below — read-only filesystem, dropped capabilities, `:ro` sub-tree bind.
- **Wrong choice when:** rootless / daemonless required — use `podman`; Kubernetes deploy — use `kubectl`/`helm`. **Version floor:** >=29.5.2 — earlier engines carry CVE-2026-32288 (manifest DoS) plus CVE-2026-41567 / CVE-2026-41568 / CVE-2026-42306 (`docker cp` host-root TOCTOU, fixed in 29.5.1; 29.5.2 fixes the 29.5.1 `docker cp` regression). **Install posture:** the linux `curl -fsSL https://get.docker.com | sudo sh` recipe is an unsigned channel — prefer Docker's signed apt repository (download.docker.com, signed-by GPG key) or the signed brew (mac) / winget (win) channels.

#### Sandbox callout — host-mount + privilege

The default recipe above bind-mounts the entire repo root read-write, which exposes `.env*`, `.git/`, `.aws/`, `.npmrc`, `.docker/config.json`, `~/.kube/config`, `.hatch3r/learnings/`, and `node_modules` to a compromised post-install script inside the container (D15-M15). On Linux, a process running as root inside a non-rootless container can write back through that mount with host-root semantics. F15.7-H5 (Cycle 10 D15-SA15.7) + D15-M15 hardening — copy the relevant flags into your runs when the workload comes from untrusted sources (third-party image, agent-generated `docker run` command, public Dockerfile):

- Read-only filesystem: `--read-only --tmpfs /tmp` keeps the container from writing back to the host even via `/app`.
- Drop root: `--user "$(id -u):$(id -g)"` or rely on the image's non-root `USER` directive. Without it, a process inside the container runs as host root on Linux when Docker Desktop's user remapping is disabled.
- Block privilege escalation: `--security-opt no-new-privileges:true` neutralises setuid binaries inside the image.
- Mount the smallest necessary sub-tree: `-v "$PWD/src:/app/src:ro"` instead of the full repo root. Never bind-mount `~`, `/`, or `/var/run/docker.sock` to an untrusted container — the socket grants host root.
- Reference: https://docs.docker.com/engine/security/rootless/ (rootless Docker Engine), https://docs.docker.com/engine/reference/run/#security-configuration (no-new-privileges + capability drop).

Hardened equivalent of the recipe above:
```
docker run --rm --read-only --tmpfs /tmp \
  --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -v "$PWD/src:/app/src:ro" -w /app node:22 npm test
```

### podman
- **When to use:** rootless OCI-image execution without a privileged daemon — ideal for hardened CI workers.
- **Recipe:** `podman run --rm -v "$PWD:/app:Z" -w /app node:22 npm test` (`:Z` triggers SELinux relabel on Fedora/RHEL).
- **Wrong choice when:** Swarm / Docker-Desktop integration — use `docker`; tools that hard-code `/var/run/docker.sock` (unless `podman system service` is running). **Version floor (Windows only):** >=5.8.2 — earlier Windows builds carry CVE-2026-33414 (PowerShell command injection in `podman machine init --image` on the Hyper-V backend); mac and linux builds are unaffected.

### container-use
- **Caveat (pre-1.0 stale upstream):** v0.4.2 shipped 2025-08-19; no further tagged release at 2026-05-27 (281-day gap) and no `SECURITY.md` is published. Adopt only if you accept undefined CVE disclosure paths. Track: https://github.com/dagger/container-use/releases.
- **When to use:** spinning up Dagger-managed sandbox containers for agentic coding environments — single-tenant CLI mode, git-reference checkout, lock-scoped concurrent runs.
- **Recipe:** `container-use env create --git-ref refs/heads/main --image node:22 --workdir /repo` then `cu exec npm test`.
- **Wrong choice when:** general-purpose container runtime — use `docker` or `podman`; stable D15 sandbox-escape boundary required — use `podman` rootless + selinux relabel.

#### Sandbox callout — boundary is upstream-unverified

container-use runs each environment as a Dagger-managed container, but the project is pre-1.0 with no published `SECURITY.md` and no CVE-disclosure path (see caveat above), so treat its isolation as unverified rather than a hardened boundary (D15-SA15.7-04). Item 6 of the D15 sandbox checklist names container-use alongside docker and playwright; unlike those two it had no callout until now. Before running agent-generated or untrusted work through `container-use env create` / `cu exec`, confirm what the invocation does and does not isolate:

- **Host container socket:** container-use drives a container runtime — if it reaches a host `/var/run/docker.sock`, a task inside the environment reaches the host daemon (host-root equivalent). Point it at a rootless backend (podman rootless, or Dagger's own engine) so no host-root socket is exposed.
- **Credential inheritance:** the environment can inherit the host user's environment (`AWS_*`, `GH_TOKEN`, `~/.npmrc`, `~/.aws`, `.hatch3r/learnings/`). Pass only the env vars the task needs; do not export a credential-bearing shell into `cu exec`.
- **`--workdir /repo` mount semantics:** the `--git-ref` checkout is writable inside the environment — scope it to the sub-tree the task needs and review any write-back before it merges into the host branch.
- **Untrusted workloads:** prefer `podman` rootless + SELinux relabel (`:Z`) as the stable D15 sandbox-escape boundary until container-use ships a `SECURITY.md` and a tagged post-1.0 release. Reference: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ (AAI sandbox-escape controls), https://github.com/dagger/container-use.

---

## Git TUI / diff viewers

### lazygit
- **When to use:** keyboard-driven terminal UI for staging, rebasing, branch switching — humans only; agents should call plain `git`.
- **Recipe:** `lazygit -p path/to/repo` (TTY required; hangs in non-TTY).
- **Wrong choice when:** autonomous agent or CI — use plain `git status`/`add`/`commit` for parseable stdout.

### delta
- **When to use:** viewing unified git diffs with side-by-side syntax-coloured hunks (ANSI pager).
- **Recipe:** `git config --global core.pager delta` then `git config --global interactive.diffFilter 'delta --color-only'`.
- **Wrong choice when:** scripted consumers — ANSI breaks parsers; semantic refactor review — use `difftastic`. **Version floor:** >=0.8.3 — earlier builds carry CVE-2021-36376 (GHSA-5xg3-j2j6-rcx4 path traversal, fixed in git-delta 0.8.3).

### difftastic
- **When to use:** syntax-aware diffing that reports semantic edits (rename of block does not show as wholesale rewrite).
- **Recipe:** `git -c diff.external=difft diff HEAD~1 HEAD`
- **Wrong choice when:** stable POSIX diff output for scripts — use `diff -u`; quick unified-diff pager — use `delta`.

### bat
- **When to use:** scrolling one source file with syntax colours, line numbers, git modification markers.
- **Recipe:** `bat --plain --line-range 50:100 src/adapters/cursor.ts`
- **Wrong choice when:** binary files (use `xxd | bat --language=hex`); strict POSIX pipelines (use `cat`); two-file compare (use `delta`). **Version floor:** >=0.18.2 — earlier builds carry CVE-2021-36753 (GHSA-p24j-h477-76q3 uncontrolled search path, fixed in bat 0.18.2).

---

## Visualisation

### overview
- **When to use:** legacy umbrella catalog of all CLI tools — this `hatch3r-cli-toolbox` skill replaces it. Retained as a category cell for back-references in user content; if you see hatch3r-cli-overview mentioned anywhere (un-backticked here to keep the cross-reference scanner clean), treat it as a synonym for this toolbox.

---

## Forges (non-GitHub)

### glab
- **When to use:** GitLab merge-request review, pipeline retries, issue triage with native PAT/OAuth auth.
- **Recipe:** `glab mr list --assignee=@me --output json | jq '.[] | {iid, title, web_url}'`
- **Wrong choice when:** GitHub-hosted — use `hatch3r-cli-gh`; Azure Repos — use `az-devops`. **Tested version:** 1.99.0 (documentation pin, not a CVE floor) — the verified baseline at last audit.

### az-devops
- **When to use:** Azure DevOps work-item edits, repo pushes, pipeline runs via the `az` CLI extension.
- **Recipe:** `az repos pr list --status active --query '[].pullRequestId' --output tsv`
- **Wrong choice when:** GitHub — use `hatch3r-cli-gh`; GitLab — use `glab`. **Tested version:** az-devops extension 1.0.4 (documentation pin; the extension floats under `az extension update`). **Install posture:** the linux `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash` recipe is an unsigned channel that runs as root — prefer Microsoft's signed apt repository (packages.microsoft.com, signed-by GPG key) or the signed winget (win) / brew (mac) channels.

---

## Browser automation

### playwright
- **When to use:** end-to-end browser test execution capturing screenshots and traces; deterministic locators, multi-browser.
- **Recipe:** `npx playwright test --grep '@smoke' --workers=1 --reporter=line`
- **Version floor:** `>=1.55.1` — earlier `npx playwright install` builds carry CVE-2025-59288 (installer man-in-the-middle, CVSS 8.7). Keep current beyond the floor so the bundled Chromium rolls the CVE-2026-2441 fix; pin the sandbox container image to a current `*-noble` tag.
- **Wrong choice when:** API-only system — use `curl` + `jq`; agent-driven natural-language browsing — use `stagehand`.

#### Sandbox callout — credential isolation when navigating untrusted URLs

Playwright launches real Chrome / Firefox / WebKit processes that inherit the host user's environment (`HOME`, `~/.aws`, browser profiles under `~/.config/google-chrome/`). Visiting an attacker-controlled URL with the host user's credential store is the equivalent of granting that URL read access to every site you are logged into. F15.7-H5 (Cycle 10 D15-SA15.7) hardening — apply when navigating to URLs the agent has not vetted:

- Disposable profile: pass `userDataDir: tmp.dirSync().name` (or `--user-data-dir=$(mktemp -d)`) so the browser sees no saved sessions, no autofill, no cookies from the host profile.
- Run inside the official sandbox image: Microsoft maintains pinned, signed Playwright containers — `mcr.microsoft.com/playwright:v1.60.0-noble` (pin a current tag; keep it current so the bundled Chromium carries the CVE-2026-2441 fix — an 18-month-stale tag like `v1.49.0-jammy` ships an unpatched browser-engine RCE). The image preinstalls every browser binary and isolates filesystem + network from the host. Reference: https://playwright.dev/docs/docker (Microsoft's official Playwright image is the maintained surface; pin to the immutable digest of a current release).
- Disable hardware acceleration / GPU access on untrusted runs: `args: ['--disable-gpu', '--no-sandbox']` is acceptable inside a hardened container, never on the host.
- Reset between scenarios: `await context.close(); context = await browser.newContext();` between unvetted URLs so cookie state does not leak across hops.
- **D15-M14: `playwright codegen <url>` against an authed site.** `npx playwright codegen` opens a browser session the user logs into, then writes the captured locators and credentials into a test file on disk. Running codegen against a host browser profile bakes the live session cookie / Authorization header into the emitted test, exposing the credential in any artefact the test is checked into. Mitigation: always pass `--save-storage=storageState.json` to capture state into a single named file you can scrub or `.gitignore` (instead of writing inline credentials), pass `--user-data-dir=$(mktemp -d)` so codegen does not start from the host's logged-in profile, and review the emitted test for any literal token, bearer string, or `cookie:` header before committing. Reference: https://playwright.dev/docs/codegen#preserve-authenticated-state (preserve auth via the storage-state file rather than inline credentials).
- Reference: https://playwright.dev/docs/release-notes (current release surface), https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ (AAI04 untrusted-input handling).

Hardened equivalent of the recipe above (inside Microsoft's pinned image):
```
docker run --rm --network none -v "$PWD:/work:ro" -w /work \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  npx playwright test --grep '@smoke' --workers=1 --reporter=line
```

### stagehand
- **When to use:** natural-language browser steering with on-the-fly DOM reasoning; v3 (2025-10-29) talks Chrome DevTools Protocol directly. Drivers (`playwright-core`, `puppeteer-core`, `patchright-core`) are peer deps — install only the one you need.
- **Recipe:** `npx create-browser-app` scaffolds a v3 project; runtime: `stagehand.act("click the login button")`.
- **Driver trust (D15-SA15.7-F-15.7-08):** prefer `playwright-core` (Microsoft) as the default driver. `puppeteer-core` (Google) is also vendor-maintained; `patchright-core` is a less-vetted community detection-bypass fork with a different supply-chain trust profile. Pin whichever driver you install.
- **Wrong choice when:** high-volume scraping — use Browserbase managed browsers or v3 action cache; air-gapped CI — pre-record then replay; existing stable Playwright suite — keep it.

---

## Compression

### zstd
- **When to use:** high-ratio compression with single-digit-millisecond decompress speeds — cold-storage payloads, CI artifact upload.
- **Recipe:** `tar --zstd -cf bundle.tar.zst dist/ docs/`
- **Version floor:** 1.5.7 (2025-02-19, the current release) — a documentation drift-baseline pin (Meta ships zstd on a ~annual tag cadence), not a live-CVE floor. Any current build clears CVE-2022-4899 (HIGH, CVSS 7.5, empty-string CLI argument → buffer overrun in the 1.4.x era).
- **Wrong choice when:** distribution where every byte counts and decompress speed is irrelevant — use `xz -9e`; legacy Windows recipients — use `zip`; already-compressed payloads — skip compression.

---

## Detection & install

Verify each tool with `command -v <bin>`. Install commands.

#### D15-M16: provenance / signature posture per channel

Each install command below resolves to one of four trust postures. Read the posture before running any install command on an end-user machine — `cargo install` and `bash <(curl … | sh)` channels lack vendor-signed artefacts and require additional vetting.

| Posture | Channels | What it means | Mitigation when posture is "unsigned" |
|---------|----------|---------------|---------------------------------------|
| Signed | `brew` (homebrew/cask), `apt` (signed repo + `Signed-By`), `snap`, `npm` with `--provenance` / `npm audit signatures`, Microsoft Store, Mac App Store | Channel verifies a vendor signature against a pinned key before installing | (none) |
| Vendor-pinned | `pipx`, `pip` (lockfile + `--require-hashes`), `go install` against `proxy.golang.org` + `GOSUMDB=on` | Channel checksums or transparency log verifies that the resolved tarball matches the version's pinned hash | Verify lockfile committed, `GOSUMDB=sum.golang.org` not set to `off` |
| Unsigned | `cargo install <crate>` (crates.io publishes tarballs without per-release Sigstore signatures), `pipx install` directly from PyPI without `--require-hashes` | Channel ships the resolved tarball but does not verify it against a vendor signature; integrity is per-channel checksum only | Pin the version, verify SHA-256 against the project's published release, prefer `--locked` (cargo) or `--require-hashes` (pip); avoid running on a credential-bearing machine |
| Curl-piped-shell | `bash <(curl … get.comby.dev)`, `curl -fsSL … install.sh \| bash` | No checksum, no signature, attacker who controls the URL gets shell on your machine. Vendor maintained but unsigned at the channel level | Download the script first (`curl -fsSL <url> -o install.sh`), inspect it, optionally pin to a committed SHA via `git show <ref>:install.sh \| bash`, never `\| bash` straight from an untrusted network |

Install commands:

| Tool | mac (`brew`) | linux (`apt` / `pip` / other) |
|------|--------------|--------------------------------|
| `aichat` | `brew install aichat` | `cargo install aichat` |
| `ast-grep` | `brew install ast-grep` | `cargo install ast-grep --locked` |
| `az-devops` | `brew install azure-cli && az extension add --name azure-devops` | `curl -sL https://aka.ms/InstallAzureCLIDeb \| sudo bash && az extension add --name azure-devops` (unsigned — prefer the signed apt repo per Install posture) |
| `bat` | `brew install bat` | `apt install bat` (binary may be `batcat`) |
| `comby` | `brew install comby` | `bash <(curl -sL get.comby.dev)` |
| `container-use` | `brew install dagger/tap/container-use` | `curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh \| bash` |
| `csvkit` | `pipx install csvkit` | `pipx install csvkit` |
| `curl` | `brew install curl` (pin >=8.21.0) | `apt install curl` (verify >=8.21.0) |
| `dasel` | `brew install dasel` (pin >=3.11.0) | `go install github.com/tomwright/dasel/v3/cmd/dasel@latest` |
| `delta` | `brew install git-delta` | `apt install git-delta` (or download release) |
| `difftastic` | `brew install difftastic` | `cargo install difftastic` |
| `docker` | `brew install --cask docker` | `apt install docker.io` |
| `duckdb` | `brew install duckdb` | download from https://duckdb.org/ |
| `glab` | `brew install glab` | `snap install glab` (only in Ubuntu universe 24.04+; or GitLab release `.deb`) |
| `httpie` | `brew install httpie` | `snap install httpie` (or `pipx install httpie`) |
| `lazygit` | `brew install lazygit` | `apt install lazygit` |
| `llm` | `brew install llm` | `pipx install llm` |
| `miller` | `brew install miller` | `apt install miller` |
| `mods` | `brew install charmbracelet/tap/mods` | `apt install mods` (Charm repo) |
| `playwright` | `npm install -D @playwright/test && npx playwright install` (pin >=1.55.1) | same (verify >=1.55.1; sandbox image `mcr.microsoft.com/playwright:v1.60.0-noble`) |
| `podman` | `brew install podman` | `apt install podman` |
| `qsv` | `brew install qsv` | `cargo install qsv` |
| `rtk` | `brew install rtk-ai/tap/rtk` | check upstream release |
| `sd` | `brew install sd` (1.1.0) | `cargo binstall sd` (v1.1.0 GitHub release; `cargo install sd` pins crates.io 1.0.0 — older, no `-A`/`--across`) |
| `stagehand` | `npm install -g @browserbasehq/stagehand` | same |
| `taplo` | `brew install taplo` | `cargo install taplo-cli --locked` |
| `xh` | `brew install xh` (pin >=0.25.3) | `cargo install xh --locked` |
| `yq` | `brew install yq` | `apt install yq` (verify mikefarah Go build, not python wrapper) |
| `zstd` | `brew install zstd` | `apt install zstd` |

## References

This skill synthesizes 25 pre-existing in-repo per-tool skills (collapsed in v1.9.0 under the toolbox criterion: a family of related single-purpose CLI-tool helpers is authored as one multi-tool skill rather than as N separate artifacts, for lean single-source coverage). The original source files (now removed) lived at the following paths (IDs intentionally un-backticked here so the cross-reference scanner does not treat removed standalone skills as broken canonical IDs):

- skills/hatch3r-cli-aichat/SKILL.md
- skills/hatch3r-cli-ast-grep/SKILL.md
- skills/hatch3r-cli-az-devops/SKILL.md
- skills/hatch3r-cli-bat/SKILL.md
- skills/hatch3r-cli-comby/SKILL.md
- skills/hatch3r-cli-csvkit/SKILL.md
- skills/hatch3r-cli-delta/SKILL.md
- skills/hatch3r-cli-difftastic/SKILL.md
- skills/hatch3r-cli-docker/SKILL.md
- skills/hatch3r-cli-duckdb/SKILL.md
- skills/hatch3r-cli-glab/SKILL.md
- skills/hatch3r-cli-lazygit/SKILL.md
- skills/hatch3r-cli-llm/SKILL.md
- skills/hatch3r-cli-miller/SKILL.md
- skills/hatch3r-cli-mods/SKILL.md
- skills/hatch3r-cli-overview/SKILL.md
- skills/hatch3r-cli-playwright/SKILL.md
- skills/hatch3r-cli-podman/SKILL.md
- skills/hatch3r-cli-qsv/SKILL.md
- skills/hatch3r-cli-rtk/SKILL.md
- skills/hatch3r-cli-sd/SKILL.md
- skills/hatch3r-cli-stagehand/SKILL.md
- skills/hatch3r-cli-taplo/SKILL.md
- skills/hatch3r-cli-yq/SKILL.md
- skills/hatch3r-cli-zstd/SKILL.md

Per hatch3r's artifact-inventory and redundancy analysis, the rejected merge alternative (keep every tool as a standalone skill) was rejected because the 25 collapsed entries averaged 75 lines each (1.9k lines total) with >70% structural duplication of the same "When to Use / Token Cost / Recipes / Wrong Choice / Alternatives / Install" frame — collapse into a single category-indexed reference cuts the surface to ~385 lines — grown from the initial ~250-line target as per-tool security and sandbox callouts were added, still far below the ~1.9k lines of 25 standalone skills — while preserving the discriminator that picks one tool over another.
