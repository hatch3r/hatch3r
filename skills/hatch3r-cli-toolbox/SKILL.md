---
id: hatch3r-cli-toolbox
description: "Category-indexed reference for 25 specialist CLI tools beyond the always-on five (ripgrep, jq, gh, fd, fzf). Use to pick the right tool for ai-chat, structural-search, sed-style edits, data ops, browser automation, container ops, and more."
tags: [cli-tools, reference, orchestration, maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# CLI Toolbox

Compact decision reference for 25 specialist CLI tools agents may reach for in addition to the five always-on skills (`hatch3r-cli-ripgrep`, `hatch3r-cli-jq`, `hatch3r-cli-gh`, `hatch3r-cli-fd`, `hatch3r-cli-fzf`).

Each entry below states a single discriminator ("When to use"), one representative recipe, and the better alternative ("Wrong choice when"). Tools are installed via `npx hatch3r cli-tools`; this skill governs *selection*, not installation.

## Category index

| Category | Tools |
|----------|-------|
| AI / LLM | `aichat`, `llm`, `mods`, `rtk` |
| Structural search & rewrite | `ast-grep`, `comby` |
| Sed-style literal edits | `sd` |
| Format converters / queriers | `yq`, `taplo` |
| Data ops (CSV / Parquet / JSON-Lines) | `csvkit`, `duckdb`, `miller`, `qsv` |
| Containers | `docker`, `podman` |
| Git TUI / diff viewers | `lazygit`, `delta`, `difftastic`, `bat` |
| Visualisation / view | `bat`, `overview` |
| Forges (non-GitHub) | `glab` (GitLab), `az-devops` (Azure DevOps) |
| Browser automation | `playwright`, `stagehand` |
| Compression | `zstd` |
| React state | `rtk` (caveat — see below) |

(Some tools appear in two cells when their best use spans categories.)

## Token-cost discipline

CLI tools return structured stdout that fits in <1 KB for typical queries; equivalent MCP calls regularly exceed 10 KB. Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction. Apply this same discipline across every tool below: prefer `--json`/`--output json`, scope with flags, cap with `--max-count` / `LIMIT`, project with `jq -r`.

---

## AI / LLM

### aichat
- **When to use:** RAG-enabled multi-provider conversational shell with saved session history; preferred for multi-turn refinement.
- **Recipe:** `aichat --rag mydocs 'how do we configure auth?'` — query a pre-built local RAG index.
- **Wrong choice when:** scripted Unix-pipeline transforms — use `mods`; plugin-rich CI workflows — use `llm`.

### llm
- **When to use:** model-agnostic shell prompting with prompt templates, embeddings, and a plugin ecosystem; preferred for CI batch jobs.
- **Recipe:** `llm -t code-review -m claude-3-5-sonnet < patch.diff`
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
- **When to use:** Tree-sitter AST pattern matches and rewrites scoped to a single grammar (TS, Python, Rust, Go).
- **Recipe:** `sg run -p 'await $FN()' -r 'await ($FN()).catch(e => log(e))' --update-all src/`
- **Wrong choice when:** plain literal text — use `hatch3r-cli-ripgrep`; multi-language SAST rule packs — use `semgrep`.

### comby
- **When to use:** declarative `:[hole]` pattern match-and-rewrite spanning mixed-language repositories — single template, 30+ grammars.
- **Recipe:** `comby 'console.log(:[arg])' 'logger.info(:[arg])' -i src/`
- **Wrong choice when:** language-precise type-aware refactor — use `ast-grep`; plain text — use `sd`.

---

## Sed-style literal edits

### sd
- **When to use:** literal-string stream substitution with no regex foot-guns — defaults to regex but `-s` switches to literal mode.
- **Recipe:** `rg --files-with-matches 'oldName' -tts | xargs sd 'oldName' 'newName'`
- **Wrong choice when:** identifier-aware rename — use `ast-grep`; multi-step transforms — use `sed -e`.

---

## Format converters & queriers

### yq
- **When to use:** editing Kubernetes manifests, Helm values, or GitHub-Actions workflows in place — preserves comments/anchors with `-P`.
- **Recipe:** `yq -i '.version = "1.7.5"' .hatch3r/hatch.json`
- **Wrong choice when:** JSON input — use `hatch3r-cli-jq`; TOML — use `taplo`.

### taplo
- **When to use:** formatting, linting, and querying TOML (`pyproject.toml`, `Cargo.toml`); bundled schemas for both.
- **Recipe:** `taplo get -f Cargo.toml package.version`
- **Wrong choice when:** YAML/JSON — use `yq`/`jq`; cross-format conversion — use `dasel`.

---

## Data ops (CSV / Parquet / JSON-Lines)

### csvkit
- **When to use:** Python-powered CSV toolkit covering `csvlook`, `csvsql`, `csvjoin`, `csvstat` — best for ad-hoc EDA and SQL-over-CSV.
- **Recipe:** `csvsql --query 'SELECT name FROM data WHERE active = 1' data.csv`
- **Wrong choice when:** files >1M rows — use `duckdb`; single-column slice — use `qsv`.

### duckdb
- **When to use:** ad-hoc analytical SQL over local Parquet, CSV, JSON; streams reads so memory stays bounded.
- **Recipe:** `duckdb -c "SELECT count(*) FROM 'data/*.parquet'"`
- **Wrong choice when:** <10k rows and column slice only — use `qsv`; transactional writes — use SQLite/Postgres.

### miller
- **When to use:** `awk`-like record processing across CSV/TSV/JSON-Lines streams with the `put`/`filter` DSL.
- **Recipe:** `mlr --icsv --ojson put '$tax = $amount * 0.07' transactions.csv`
- **Wrong choice when:** multi-GB analytical joins — use `duckdb`; trivial slicing — use `qsv`.

### qsv
- **When to use:** fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained `xsv` successor (`BurntSushi/xsv` archived 2025-04-24, `jqnatividad/qsv` is the active fork).
- **Recipe:** `qsv search -s email '@example\.com$' users.csv`
- **Wrong choice when:** Parquet/JSON or window functions — use `duckdb`; per-record DSL transforms — use `miller`.

---

## Containers

### docker
- **When to use:** image build, container run, exec inspection, registry push against a running Docker Engine daemon.
- **Recipe:** `docker run --rm -v "$PWD":/app -w /app node:22 npm test`
- **Wrong choice when:** rootless / daemonless required — use `podman`; Kubernetes deploy — use `kubectl`/`helm`.

### podman
- **When to use:** rootless OCI-image execution without a privileged daemon — ideal for hardened CI workers.
- **Recipe:** `podman run --rm -v "$PWD:/app:Z" -w /app node:22 npm test` (`:Z` triggers SELinux relabel on Fedora/RHEL).
- **Wrong choice when:** Swarm / Docker-Desktop integration — use `docker`; tools that hard-code `/var/run/docker.sock` (unless `podman system service` is running).

---

## Git TUI / diff viewers

### lazygit
- **When to use:** keyboard-driven terminal UI for staging, rebasing, branch switching — humans only; agents should call plain `git`.
- **Recipe:** `lazygit -p path/to/repo` (TTY required; hangs in non-TTY).
- **Wrong choice when:** autonomous agent or CI — use plain `git status`/`add`/`commit` for parseable stdout.

### delta
- **When to use:** viewing unified git diffs with side-by-side syntax-coloured hunks (ANSI pager).
- **Recipe:** `git config --global core.pager delta` then `git config --global interactive.diffFilter 'delta --color-only'`.
- **Wrong choice when:** scripted consumers — ANSI breaks parsers; semantic refactor review — use `difftastic`.

### difftastic
- **When to use:** syntax-aware diffing that reports semantic edits (rename of block does not show as wholesale rewrite).
- **Recipe:** `git -c diff.external=difft diff HEAD~1 HEAD`
- **Wrong choice when:** stable POSIX diff output for scripts — use `diff -u`; quick unified-diff pager — use `delta`.

### bat
- **When to use:** scrolling one source file with syntax colours, line numbers, git modification markers.
- **Recipe:** `bat --plain --line-range 50:100 src/adapters/cursor.ts`
- **Wrong choice when:** binary files (use `xxd | bat --language=hex`); strict POSIX pipelines (use `cat`); two-file compare (use `delta`).

---

## Visualisation

### overview
- **When to use:** legacy umbrella catalog of all CLI tools — this `hatch3r-cli-toolbox` skill replaces it. Retained as a category cell for back-references in user content; if you see hatch3r-cli-overview mentioned anywhere (un-backticked here to keep the cross-reference scanner clean), treat it as a synonym for this toolbox.

---

## Forges (non-GitHub)

### glab
- **When to use:** GitLab merge-request review, pipeline retries, issue triage with native PAT/OAuth auth.
- **Recipe:** `glab mr list --assignee=@me --output json | jq '.[] | {iid, title, web_url}'`
- **Wrong choice when:** GitHub-hosted — use `hatch3r-cli-gh`; Azure Repos — use `az-devops`.

### az-devops
- **When to use:** Azure DevOps work-item edits, repo pushes, pipeline runs via the `az` CLI extension.
- **Recipe:** `az repos pr list --status active --query '[].pullRequestId' --output tsv`
- **Wrong choice when:** GitHub — use `hatch3r-cli-gh`; GitLab — use `glab`.

---

## Browser automation

### playwright
- **When to use:** end-to-end browser test execution capturing screenshots and traces; deterministic locators, multi-browser.
- **Recipe:** `npx playwright test --grep '@smoke' --workers=1 --reporter=line`
- **Wrong choice when:** API-only system — use `curl` + `jq`; agent-driven natural-language browsing — use `stagehand`.

### stagehand
- **When to use:** natural-language browser steering with on-the-fly DOM reasoning; v3 (2025-10-29) talks Chrome DevTools Protocol directly. Drivers (`playwright-core`, `puppeteer-core`, `patchright-core`) are peer deps — install only the one you need.
- **Recipe:** `npx create-browser-app` scaffolds a v3 project; runtime: `stagehand.act("click the login button")`.
- **Wrong choice when:** high-volume scraping — use Browserbase managed browsers or v3 action cache; air-gapped CI — pre-record then replay; existing stable Playwright suite — keep it.

---

## Compression

### zstd
- **When to use:** high-ratio compression with single-digit-millisecond decompress speeds — cold-storage payloads, CI artifact upload.
- **Recipe:** `tar --zstd -cf bundle.tar.zst dist/ governance/`
- **Wrong choice when:** distribution where every byte counts and decompress speed is irrelevant — use `xz -9e`; legacy Windows recipients — use `zip`; already-compressed payloads — skip compression.

---

## Detection & install

Verify each tool with `command -v <bin>`. Install commands:

| Tool | mac (`brew`) | linux (`apt` / `pip` / other) |
|------|--------------|--------------------------------|
| `aichat` | `brew install aichat` | `cargo install aichat` |
| `ast-grep` | `brew install ast-grep` | `cargo install ast-grep --locked` |
| `az-devops` | `brew install azure-cli && az extension add --name azure-devops` | `apt install azure-cli && az extension add --name azure-devops` |
| `bat` | `brew install bat` | `apt install bat` (binary may be `batcat`) |
| `comby` | `brew install comby` | `bash <(curl -sL get.comby.dev)` |
| `csvkit` | `pipx install csvkit` | `pipx install csvkit` |
| `delta` | `brew install git-delta` | `apt install git-delta` (or download release) |
| `difftastic` | `brew install difftastic` | `cargo install difftastic` |
| `docker` | `brew install --cask docker` | `apt install docker.io` |
| `duckdb` | `brew install duckdb` | download from https://duckdb.org/ |
| `glab` | `brew install glab` | `apt install glab` (or GitLab release) |
| `lazygit` | `brew install lazygit` | `apt install lazygit` |
| `llm` | `brew install llm` | `pipx install llm` |
| `miller` | `brew install miller` | `apt install miller` |
| `mods` | `brew install charmbracelet/tap/mods` | `apt install mods` (Charm repo) |
| `playwright` | `npm install -D @playwright/test && npx playwright install` | same |
| `podman` | `brew install podman` | `apt install podman` |
| `qsv` | `brew install qsv` | `cargo install qsv` |
| `rtk` | `brew install rtk-ai/tap/rtk` | check upstream release |
| `sd` | `brew install sd` | `cargo install sd` |
| `stagehand` | `npm install -g @browserbasehq/stagehand` | same |
| `taplo` | `brew install taplo` | `cargo install taplo-cli --locked` |
| `yq` | `brew install yq` | `apt install yq` (verify mikefarah Go build, not python wrapper) |
| `zstd` | `brew install zstd` | `apt install zstd` |

## References

This skill synthesizes 25 pre-existing in-repo per-tool skills (collapsed in v1.9.0 per the Decision #14 toolbox criterion in `.claude/rules/content-authoring.md`). The original source files (now removed) lived at the following paths (IDs intentionally un-backticked here so the cross-reference scanner does not treat removed standalone skills as broken canonical IDs):

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

Per `governance/audit/domains/D16-compound-system.md` SA 16.3, the rejected merge alternative (keep every tool as a standalone skill) was rejected because the 25 collapsed entries averaged 75 lines each (1.9k lines total) with >70% structural duplication of the same "When to Use / Token Cost / Recipes / Wrong Choice / Alternatives / Install" frame — collapse into a single category-indexed reference cuts the surface to ~250 lines while preserving the discriminator that picks one tool over another.
