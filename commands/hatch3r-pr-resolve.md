---
id: hatch3r-pr-resolve
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-lint-fixer, hatch3r-testability, hatch3r-reviewer, hatch3r-fixer, hatch3r-security, hatch3r-docs-writer, hatch3r-ui, hatch3r-ux, hatch3r-performance]
description: "Read open PR comments, evaluate each against current code via the rigor contract, implement accepted findings, reply inline. Multi-platform."
argument-hint: "[pr-number]"
disable-model-invocation: true
tags: [implementation, review, ctx:team-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
plan_gate: true
sub_agents_spawned:
  count: 10
  rationale: Per-PR fanout — implementer, lint-fixer, testability (CQ5, FIX NOW group, parallel), reviewer ↔ fixer review loop (max 3 iterations), then parallel Tier-3 final-quality specialists (security (CQ3), docs-writer, performance (CQ7), plus ui (CQ1) and ux (CQ2) as mandatory-on-match Tier 2/3 gates — a trigger-glob match requires a dedicated instance) per the Tier-3 specialist mandate. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: contradictory inputs, missing target, unknown convention.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Identify PR | Orchestrator (inline) | No | Yes |
| 1.6. Base-branch sync gate | Orchestrator (inline) + `hatch3r-fixer` | Per conflicted file | When PR branch is behind or conflicted with base |
| 2. Fetch comments | Orchestrator (inline, platform CLI) | Per scope | Yes |
| 3. Normalize | Orchestrator (inline) | No | Yes |
| 4. Evaluate (rigor contract) | Orchestrator (inline) | Per finding | Yes |
| 5. Triage routing + ASK gate | Orchestrator (inline) | No | Yes |
| 6. Fix implementation | `hatch3r-implementer`, `hatch3r-lint-fixer`, `hatch3r-testability` | Per finding group | When FIX NOW items exist |
| 7a. Review loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | When code changed (Tier 2/3) |
| 7b. Final quality — mandatory | `hatch3r-testability`, `hatch3r-security` | Yes | When code changed |
| 7c. Final quality — mandatory-on-match + conditional | `hatch3r-ui`, `hatch3r-ux` (mandatory-on-match); `hatch3r-docs-writer`, `hatch3r-performance`, `hatch3r-lint-fixer` (conditional) | Yes | When triggered (ui/ux non-skippable on trigger-glob match at Tier 2/3) |
| 8. Post replies | Orchestrator (inline, platform CLI) | Per comment | Yes |
| 9. Commit and push | Orchestrator (inline) | No | When code changed |
| 9.5. Re-poll gate | Orchestrator (inline) | No | When commit pushed |
| 10. Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

---

# PR Resolve -- Read, Evaluate, Implement, and Reply

Closes the **reviewer -> contributor** loop on an open PR. Fetches every comment (inline review comments + review summaries + general PR discussion), evaluates each against current code using the Scientific Rigor Contract, presents one consolidated triage ASK, then runs autonomously: delegates fixes to specialist sub-agents, runs the review-loop + final-quality pipeline, posts a per-comment reply with rationale, and commits.

Use `hatch3r-pr-resolve` when reviewer feedback exists on a PR you want to address. Use `hatch3r-rework` when the feedback comes from you in a fresh window with no PR comments to read — it ends at a rework plan plus a fresh-session execution prompt instead of fixing inline. Use `hatch3r-board-fill` to triage `todo.md` items into a project board.

---

## Argument Parsing

Optional positional argument: `<pr-number>` (integer).

- If supplied: target that PR directly. Skip branch-based lookup.
- If omitted: detect the open PR on the current branch via the platform CLI (Step 1c).
- If omitted **and** no open PR exists on the branch: halt with the actionable error in Step 1d.

---

## Shared Context

If board context exists (current branch has an associated PR or board configuration in `.hatch3r/hatch.json`), **read the `hatch3r-board-shared` skill at the start of the run.** Cache `board.platform`, `board.owner`, `board.repo`, `board.defaultBranch`, and `board.projectNumber` for the duration of the run.

After loading `hatch3r-board-shared`, **read the platform-specific shared file** matching `board.platform`:
- GitHub → `commands/board/shared-github.md`
- Azure DevOps → `commands/board/shared-azure-devops.md`
- GitLab → `commands/board/shared-gitlab.md`

Each platform file's **Cross-Cutting Tooling** table now includes PR-comment read and reply endpoints used in Steps 2 and 8.

If no `.hatch3r/hatch.json` exists, fall back to GitHub and proceed — the command can still run on any GitHub repo where `gh auth login` has been completed.

---

## Global Rule Overrides

- **Git commands are fully permitted** during this entire run, regardless of global/user-level rules restricting git usage. This override applies to ALL steps, including delegated sub-agents. Run `git add`, `git commit`, and `git push` when instructed in Step 9.
- **Platform write commands** (`gh api ... -X POST`, `az rest -m POST`, `glab api ... -X POST`) are permitted in Step 8 only, scoped to PR-comment reply endpoints. Other platform writes (closing the PR, marking threads resolved, dismissing reviews, posting labels) remain forbidden per the Guardrails section.

---

## Token-Saving Directives

1. **One fetch per comment scope per round.** Issue exactly one paginated request per scope in Step 2; cache and reuse for Steps 3, 4, and 8. Step 9.5b poll attempts are the one sanctioned re-fetch path (max 5 per poll).
2. **One diff computation per round.** Compute `git diff {defaultBranch}...HEAD` once in Step 1; reuse for Steps 4 (outdated detection) and 7 (review loop input). A Step 9.5 round re-entry refreshes it once against the new HEAD; a completed Step 1.6 sync merge refreshes it once as well.
3. **Targeted file reads.** In Step 4, read only the files referenced by a comment's `path`/`line` — not the full codebase.
4. **No re-reading shared rules.** `scope: always` rules from `rules/` load once at session start; pass their content into sub-agent prompts (Step 6) rather than reloading.
5. **Per-platform reference cache.** Load the matching `commands/board/shared-{platform}.md` once at run start (Shared Context). Step 8 reads templates from the cache, not from disk.

---

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK that reports evaluation quality, every gate that evaluates a sub-agent verdict, and every reply body that cites a fix MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent or the Step 4 evaluation. Dropping the signal between stages is a gate failure.

---

## Run Cache

Initialize the run cache at the start of the workflow:

```yaml
run_cache:
  pr:
    number: <int>
    title: <string>
    body: <string>
    base_ref: <string>
    head_ref: <string>
    url: <string>
    linked_issues: [<int>, ...]
  sync_gate:
    outcome: <passed | synced | declined | not-run>   # Step 1.6 + Step 9 pre-push re-check
    behind_n: <int>
    conflicts: [{file, kind, resolution, risk}, ...]  # empty when the 1.6a probe is clean
  raw_comments:
    inline: [<comment>, ...]
    review_summaries: [<review>, ...]
    discussion: [<comment>, ...]
  normalized_findings: [<finding>, ...]      # Step 3 output
  evaluation_results: [<evaluation>, ...]    # Step 4 output keyed by finding.comment_id
  triage_decisions: [<decision>, ...]        # Step 5 output (post-ASK)
  fix_results:
    fix_agents_invoked: [<name>, ...]        # runtime log of agents invoked (distinct from the P8 B2 frontmatter `sub_agents_spawned` emission, which is the static fan-out contract)
    files_changed: [<path>, ...]
    findings_addressed: [<comment_id>, ...]
    findings_blocked: [<comment_id>, ...]
  review_loop:
    iterations: [<verdict>, ...]
    final_verdict: <clean|warning|critical>
    confidence: <high|medium|low>
  reply_drafts: [{comment_id, body, endpoint}, ...]
  reply_post_results: [{comment_id, status: posted|failed, error?: <string>}, ...]
  deferred_findings: [<finding>, ...]        # written to todo.md in Step 5c
  ledger_file: <path of this run's findings-ledger JSONL>  # .hatch3r/findings/<YYYY-MM-DD>-pr-resolve-<run8>.jsonl per rules/hatch3r-findings-ledger.md
  round:
    index: <int, 1-based>                    # initialized 1; incremented per Step 9.5 re-poll round
    started_at: <iso>                        # run start; reset to now when a re-poll round begins (9.5b)
    comments_per_round: [<int>, ...]         # per-round comment count — [0] = Step 3 finding count, then 9.5b retained counts
  errors: [<error_record>, ...]
```

---

## Workflow

Execute these steps in order. **Do not skip any step.** Three ASK gate classes bound the run: Step 1.6 (sync consent, only when the base probe finds drift or conflicts), Step 5 (triage routing, once per round), and Step 9.5 (re-poll consent, after each push). After the user accepts triage, each round runs autonomously through Step 9 (the pre-push re-check re-opens the Step 1.6 sync ASK only when base moved mid-run); Step 9.5 bounds the loop; Step 10 closes the run.

---

## Step 0: Triage

Classify the run before delegating. Counts and severity come from the Step 4 evaluation, so reorder if needed — for runs with no comments at all, take the early-exit path in Step 2.

- **Tier 1** (≤5 comments, all single-line nits, 0 critical, 0 architectural-discussion items): reduced pipeline — implement inline or via one specialist; skip Step 7a review loop; still run Step 7b mandatory specialists (hatch3r-testability, hatch3r-security).
- **Tier 2** (6–30 comments, mixed severity, no critical disagreements or design objections): standard pipeline — Steps 6, 7a (review loop, max 3 iterations), 7b mandatory + 7c triggered.
- **Tier 3** (>30 comments OR any Critical-severity item OR any architectural-discussion item OR cross-cutting changes): full pipeline + merge-readiness assessment after Step 9.

Tier assignment is recomputed after Step 4 (when severity is known). If the initial Step 0 read of raw counts says Tier 1 but Step 4 reveals a Critical-severity item, upgrade to Tier 3 before the Step 5 ASK.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 5 ASK gate (the comment-resolution mutation gate, after which fan-out begins in Step 6), surface the cost preview so a large comment-resolution run is never approved blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 tier (recomputed in Step 4e once severities are known). A PR with zero unresolved comments short-circuits at Step 2d and spawns nothing, so `expected_sa_count: 0` is correct for that case.

```yaml
cost_estimate:
  expected_sa_count: <tier → Tier 1 ~1, Tier 2 ~4, Tier 3 up to 10; 0 when no unresolved comments>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a 40-comment PR of pure nits scored as Tier 3, or a 3-comment PR with a hidden Critical scored as Tier 1. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0/Step 4e auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- The override does NOT suppress the Critical-severity upgrade: a `--effort=light` run that surfaces a Critical item in Step 4 still runs the Tier-3 specialist mandate (Step 5). Safety dominates the cost override.
- No flag passed → the persisted `defaultEffort` manifest scalar (`.hatch3r/hatch.json`) applies when set; absent both, the Step 0/Step 4e auto-classification stands. Full chain: `--effort` flag > `defaultEffort` > auto-tier (`agents/shared/triage-vocabulary.md` → Pipeline pruning per tier). The Critical-severity upgrade above outranks every layer of the chain.

---

## Step 1: Resolve PR Identity

#### 1a. Parse Argument

1. If `<pr-number>` is present in the invocation, set `run_cache.pr.number` and skip to 1c.b (fetch by number).
2. Otherwise, identify the current branch: `git branch --show-current`. Cache as `branch`.

#### 1b. Detect Platform

1. Read `.hatch3r/hatch.json`. Extract `board.platform` (`github | azure-devops | gitlab`).
2. If absent or unreadable, default to GitHub and record a Low-confidence platform-detection finding in `run_cache.errors`.

#### 1c. Look Up the PR

Choose the platform CLI command for the `(no number provided + branch known)` case, or fetch directly by number:

**GitHub:**
- By branch: `gh pr list --head {branch} --state open --json number,title,body,url,baseRefName,headRefName --limit 1`
- By number: `gh pr view {N} --json number,title,body,url,baseRefName,headRefName`

**Azure DevOps:**
- By branch: `az repos pr list --source-branch {branch} --status active --top 1 -o json`
- By number: `az repos pr show --id {N} -o json`

**GitLab:**
- By branch: `glab mr list --source-branch {branch} --state opened --per-page 1 -F json`
- By number: `glab mr view {N} -F json`

Cache the response into `run_cache.pr`. Extract linked issues from the PR body by matching `Closes #N`, `Fixes #N`, `Resolves #N`, `Relates to #N`. Cache as `run_cache.pr.linked_issues`.

#### 1d. Halt on Missing PR

If no PR is found and no number was supplied, halt with this error verbatim (P1 actionable-error contract, `.claude/rules/cli-ux-standards.md`):

```
No open PR found on branch '{branch}'.

To target a specific PR:
  /hatch3r-pr-resolve <pr-number>

To open a PR for this branch first:
  GitHub:        gh pr create
  Azure DevOps:  az repos pr create
  GitLab:        glab mr create
```

Exit code 2 (usage error).

#### 1e. Diff Computation

Compute and cache the full diff once: `git diff {pr.baseRefName}...{pr.headRefName} > /tmp/pr-resolve-{N}.diff`. Reuse for Step 4 outdated detection and Step 7a review loop input.

---

## Step 1.6: Base-Branch Sync Gate

Runs after Step 1e, before any comment analysis. Detects whether the PR branch is behind or in conflict with its base and — with the same consent UX as comment triage (one consolidated table, one bundled ASK per round, per `agents/shared/user-question-protocol.md`) — resolves merge conflicts in-run. Step 5 stays the mutation gate for comment-resolution routing; this gate consents only to sync-merge edits. Two re-entry points cite this gate instead of duplicating it: the Step 9 pre-push re-check and the `git push`-rejected row in Error Handling.

#### 1.6a. Detection Recipe

The comparison ref `{ref}` defaults to `origin/{pr.baseRefName}`; the push-rejected re-entry runs the identical recipe with `origin/{pr.headRefName}`.

1. `git fetch origin {pr.baseRefName}` — one fetch per gate entry (the re-entry fetches `{pr.headRefName}` instead).
2. `behind_n=$(git rev-list --count HEAD..{ref})`. `0` → record `sync_gate.outcome: passed`; continue with no table and no ASK.
3. Conflict probe (Git ≥ 2.38): `git merge-tree --write-tree --name-only HEAD {ref}` — exit 0 = auto-mergeable (behind, zero conflicts); exit 1 = conflicted, conflicted paths listed after the tree OID. Fallback for older Git: `git merge --no-commit --no-ff {ref}`, collect `git diff --name-only --diff-filter=U` plus `git ls-files -u`, then `git merge --abort` — the probe never leaves a half-merged tree on disk when the ASK is presented.
4. Auto-mergeable case (`behind_n > 0`, exit 0): skip the 1.6b table; the 1.6c ASK collapses to two options — `sync` (merge `{ref}`, zero conflicts) / `skip`.

#### 1.6b. Per-Conflict Triage Table

One consolidated table mirroring the Step 5b pattern (that section owns the grouped-table + numbered-row spec; only the columns differ here). Row shape:

`[#] {file} • {kind} • ours: {one line} / theirs: {one line} • proposed: {take-ours | take-theirs | blend} — {rationale} • risk {H|M|L}`

- `kind` ∈ `content | rename | delete | binary`, derived from whichever 1.6a probe ran:
  - Primary probe (`git merge-tree`): classify from the probe's own output, re-read in full form — `git merge-tree --write-tree HEAD {ref}` without `--name-only` (zero index/worktree writes) — using the stage entries in its conflicted-file info section plus its `CONFLICT (...)` informational lines: overlapping stages → content; `CONFLICT (rename/...)` → rename; missing stage 2 or 3 → delete; `CONFLICT (binary)` → binary.
  - Fallback probe (`git merge --no-commit` ran): classify from the output captured in 1.6a before its `git merge --abort` — overlapping stages in `git ls-files -u` → content; `CONFLICT (rename/...)` stderr messages → rename; missing stage 2 or 3 → delete; a `Binary files` differ marker → binary.
  - Invariant: classification never assumes an unmerged index exists unless the fallback probe ran — the primary probe touches neither index nor worktree.
- ours = the PR branch (HEAD); theirs = `{ref}`. One line per side via `git log -1 --format='%h %s' {side} -- {file}`.
- Every `proposed:` value carries a one-phrase rationale (e.g., `take-ours — theirs touches only import order`).
- **Halt-plus-human scope cap:** binary conflicts, and conflicts in files outside the PR's own diff (the Step 1e cache), are surfaced as rows but fixed at risk H with `proposed: halt + human` — no auto-resolution proposal for either class. Consented rows still resolve; halt rows carry into the decline warning below and the Step 10 `Blockers:` line.

#### 1.6c. ASK (sync consent, one bundled prompt per round)

> PR #{N} is {behind_n} commits behind {ref} with {conflict_n} conflicts (table above). Options:
> - `sync` — apply every proposed resolution (default)
> - `sync only N,M` — resolve only the listed rows
> - `override N take-ours|take-theirs|blend` — change row N's resolution, then apply
> - `skip` — decline all; continue comment resolution on the unsynced branch

One bundled prompt covers every conflict group in the round — 2–4 numbered options per group, default = the proposed resolution, per `agents/shared/user-question-protocol.md`.

#### 1.6d. Resolution Delegation + Verification

On consent: cache `pre_sync_sha=$(git rev-parse HEAD)`, open the merge (`git merge --no-commit --no-ff {ref}`), and delegate each conflicted-file edit to the `hatch3r-fixer` sub-agent via the Task tool — per-file prompt carrying the consented resolution, both sides' conflict hunks, and the row rationale; each spawn returns the structured Fix Result with its `Delegation proof ID` (`delegation_proof_id`), the same contract the Step 7b review loop uses — quote every id in the End-of-Turn Delegation Attestation. Then `git add` the resolved paths, complete the merge commit (`pr-resolve: sync {branch} with {ref}`), refresh the Step 1e diff once against the new HEAD, record `sync_gate.outcome: synced`, and run the project build command plus the tests targeting the resolved files before proceeding to Step 2. A build or test failure re-opens the 1.6c ASK with the failure output attached (`override N ...` / `skip`) after `git reset --hard {pre_sync_sha}` restores the pre-sync state.

On `skip`: `git merge --abort` if a probe merge is open, record `sync_gate.outcome: declined`, continue comment resolution on the unsynced branch, and print this warning verbatim — once now, again on the Step 10 `Blockers:` line:

`WARNING: sync declined — {behind_n} commits behind {ref}, {conflict_n} conflicts unresolved; push will fail until synced.`

---

## Step 2: Fetch All Comments

Three scopes per platform. All requests are read-only. Cache results into `run_cache.raw_comments`.

#### 2a. GitHub

| Scope | Command |
|-------|---------|
| Inline review comments | `gh api repos/{owner}/{repo}/pulls/{N}/comments --paginate` |
| Review summaries | `gh api repos/{owner}/{repo}/pulls/{N}/reviews --paginate` |
| General PR discussion | `gh api repos/{owner}/{repo}/issues/{N}/comments --paginate` |
| Thread resolution state | `gh api graphql -f query='query{repository(owner:"{owner}",name:"{repo}"){pullRequest(number:{N}){reviewThreads(first:100){nodes{id,isResolved,comments(first:1){nodes{databaseId}}}}}}}'` |

The REST `pulls/{N}/comments` endpoint does not return resolution state; join the GraphQL `reviewThreads` response by `databaseId` to filter resolved threads. Default behavior: drop threads where `isResolved == true`. (Per user decision: bots are evaluated the same as humans — do **not** filter by `user.type == "Bot"` or by `author.login` matching `*[bot]`.)

#### 2b. Azure DevOps

Azure DevOps unifies inline and general comments into "threads".

| Scope | Command |
|-------|---------|
| All threads | `az rest -m GET --url 'https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{N}/threads?api-version=7.1-preview.1'` |

Split the returned `value[]` array by `threadContext`:
- `threadContext != null` (has `filePath` and `rightFileStart`/`rightFileEnd`) → inline review comment.
- `threadContext == null` → general PR discussion / review summary.

Filter by `status`: include `active`, `pending`, `wontFix` (still actionable); drop `fixed`, `closed`, `byDesign` (resolved). Each thread's `comments[]` array contains the actual comment bodies; the first comment is the thread's opening message.

#### 2c. GitLab

GitLab notes are unified; discussions group related notes into threads.

| Scope | Command |
|-------|---------|
| All discussions (threaded) | `glab api '/projects/{project_id}/merge_requests/{iid}/discussions?per_page=100' --paginate` |

Filter each discussion by `notes[].resolvable` and `notes[0].resolved` (the first note's resolution state governs the thread; GitLab maintains this for resolvable threads only). Drop resolved discussions. For each retained discussion:
- `notes[].position != null` → inline review comment (has `new_path`, `new_line`).
- `notes[].position == null` AND discussion appears in `/merge_requests/{iid}/notes` only (not in `/reviews`) → general PR discussion.
- Discussions corresponding to a review verdict (`type == "approval"` or system note about approval/changes-requested) → review summary.

#### 2d. Empty PR Short-Circuit

If all three scopes return zero unresolved comments, emit:

```
No unresolved comments on PR #{N}.
```

Skip to Step 10 with `Status: SUCCESS` and `Outcome: "No unresolved comments to resolve on PR #{N}."`. No code changes, no commit, no reply.

---

## Step 3: Normalize Comments into Common Findings Shape

Convert every fetched raw comment into one normalized finding. The shape is platform-agnostic; downstream steps operate on this shape only.

```yaml
finding:
  comment_id: <platform-comment-id>            # single canonical id (first of merged set)
  comment_ids: [<id>, ...]                     # all comment ids merged into this finding
  thread_id: <platform-thread-id | null>       # for inline + Azure threaded comments
  source_scope: inline | review-summary | general-discussion
  author: <username>
  author_is_bot: <bool>                        # informational only — bots are not filtered
  created_at: <iso>
  body: <raw markdown>
  file: <path | null>                          # inline only
  line: <int | null>                           # inline only (right-side line)
  parent_comment_id: <id | null>               # if a reply within a thread
  reply_endpoint:
    method: POST
    url: <fully-qualified URL>
    body_field: <key the platform expects for the comment body>
    extra_fields: {<map>}                      # e.g., in_reply_to for GitHub inline
```

**De-duplication.** Group inline comments by `(file, line)` and group general-discussion comments by exact-substring match of the first 100 body characters. Where two reviewers raise the same point, merge into one finding with `comment_ids: [a, b]` so Step 8 replies post to both.

**Thread reconstruction.** For Azure DevOps and GitLab discussions, preserve the thread structure in `thread_id`; the orchestrator replies to the thread root (the first comment), which surfaces to all participants.

---

## Step 4: Comment Evaluation (Rigor Contract Applied)

For each normalized finding, evaluate against the current code in the working tree using the six-test Scientific Rigor Contract from `agents/shared/rigor-contract.md`.

#### 4a. Targeted Code Read

- Inline comment: read the file at the comment's `line` ± 50 lines for context.
- General discussion or review summary: parse the body for file paths (`src/...`), function/symbol names, and grep the codebase for those tokens, then read the matched files.
- Cap reads at the top 5 candidate files per finding; record `evaluation.read_files` in the cache.

#### 4b. Rigor Contract Application

Produce an evaluation record per finding with these fields (matches the contract's required schema):

```yaml
evaluation:
  comment_id: <id>
  decision: ACCEPT | DECLINE | NEEDS_CLARIFICATION
  severity: Critical | Important | Cleanup | Cosmetic
  confidence: high | medium | low
  confidence_basis: <one phrase — direct measurement | sampled observation | inference from analogue>
  falsifiability: <one observation that would disprove this evaluation>
  causal_chain: <step1 → step2 → step3>          # ≥3 steps, symptom → driver → root
  bias_check: <named bias risks + how mitigated>
  counter_argument: <steelman of the opposite decision + how resolved>
  affected_files: [<path>, ...]
  proposed_action: <one paragraph — what the implementation would do>
  applicability: current | outdated | already-addressed
```

**Severity heuristic** (matches `commands/hatch3r-rework.md` Step 5 triage vocabulary):
- **Critical** — functional bug, security defect, data corruption risk, broken contract.
- **Important** — UX defect, missing test for a new code path, incomplete behavior, performance regression on a hot path.
- **Cleanup** — dead code, typo, missing type annotation, error-handling gap that does not affect functional behavior.
- **Cosmetic** — naming, formatting, comment polish.

#### 4c. Outdated Detection

For inline comments: locate the comment's `line` in the cached diff. If the line is in a deleted hunk, or if the surrounding 5-line window no longer matches the comment's `diff_hunk`, mark `applicability: outdated`. Default decision for outdated comments: `DECLINE` with reply template `DECLINE — outdated` (Step 8).

#### 4d. Already-Addressed Detection

Grep the commits between PR base and head (`git log {pr.baseRefName}..{pr.headRefName} --oneline`) for keywords from the comment body (extract noun phrases of length ≥ 2 words). If a commit message references the comment's subject, mark `applicability: already-addressed`. Default decision: `DECLINE` with reply template `DECLINE — already done`, citing the commit SHA.

#### 4e. Recompute Tier

After Step 4 completes, recompute Step 0's tier using the now-known severities. Upgrade Tier 1 -> Tier 3 if any `severity: Critical` evaluation exists.

---

## Step 5: Triage Routing + ASK Checkpoint (only mutation gate)

**Tier-3 specialist mandate (P8 B2).** For Tier 3 PRs (6+ findings OR any Critical severity), the post-fix specialist pass (`hatch3r-testability`, `hatch3r-security`, `hatch3r-docs-writer`) MUST run in parallel. A triggered mandatory-on-match specialist (`hatch3r-ui` CQ1 / `hatch3r-ux` CQ2) joins the pass as its own dedicated instance whenever the round's diff matches its trigger row (Step 7c). Specialists may NOT be deferred via "Needs your call" for cost reasons. Cost-dominance principle applies: token cost of specialist sub-agents is dominated by the quality gain of catching defects pre-merge.

#### 5a. Apply Routing Heuristics

| Severity | Confidence | Default Route |
|----------|------------|---------------|
| Critical | High | FIX NOW |
| Critical | Medium / Low | FIX NOW (flagged for extra scrutiny in Step 7a) |
| Important | High | FIX NOW |
| Important | Medium | FIX NOW |
| Important | Low | **Needs your call** |
| Cleanup | High / Medium | FIX NOW |
| Cleanup | Low | **Needs your call** |
| Cosmetic | Any | DEFER (with reply) |
| Any | `applicability: outdated` | DECLINE — outdated (with reply) |
| Any | `applicability: already-addressed` | DECLINE — already done (with reply) |

Plus dedicated buckets independent of severity:
- **DECLINE candidates** — evaluations where `decision: DECLINE` because the rigor contract found the comment incorrect (counter-argument resolved against the comment). Show the agent's reasoning; user can override to FIX NOW.
- **NEEDS_CLARIFICATION** — `decision: NEEDS_CLARIFICATION`. The agent will reply asking for more information instead of implementing.
- **Needs your call** — low-confidence ACCEPTs surfaced for the user (no auto-route, per user decision).

#### 5b. Triage Table

Present one consolidated table, grouped by bucket. Each row: `[#] {author} • {scope} • {severity}/{confidence} • route • one-line rationale`. Example:

```
PR #142 — Resolve Comments (Tier 2)

FIX NOW ({n}):
  [1] @alice • inline src/auth.ts:42 • Critical/High → token validation missing
  [2] @bob   • inline src/auth.ts:78 • Important/Medium → missing test for refresh flow
  [3] @ci-bot • inline src/db.ts:15 • Cleanup/High → unused import

DECLINE — outdated ({n}):
  [4] @alice • inline src/auth.ts:120 • code at L120 changed in commit abc1234

DECLINE — already done ({n}):
  [5] @carol • general discussion • addressed in commit def5678

NEEDS_CLARIFICATION ({n}):
  [6] @dave  • general discussion • "should we cache?" — caching strategy not specified

Needs your call ({n}):
  [7] @bob   • inline src/cache.ts:88 • Important/Low → may be intentional eviction

Escalation for low-confidence accepted findings: trigger a mandatory `hatch3r-security` pass if any are security-adjacent (auth, crypto, input validation, access control, secret handling); otherwise flag in commit message for elevated reviewer attention.

DEFER (cosmetic, with reply) ({n}):
  [8] @eve   • inline src/auth.ts:55 • Cosmetic/Medium → naming nitpick

Tier: 2 (standard pipeline)
Total: {N} comments • {fix_now_n} fix now • {decline_n} decline • {clarify_n} clarify • {needs_call_n} need your call • {defer_n} defer
```

**In-Session Plan Gate (Tier >= 2).** At Tier >= 2 the routing table above IS the run's plan artifact — persist it to `docs/plans/{YYYY-MM-DD}-pr-{N}-resolution.md` before the 5c ASK, per `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: slug from the PR number; gated dispatch = Step 6; revise = the 5c adjustment options (re-persist after edits); no unattended flag — 5c is the interactive seam.

#### 5c. ASK (triage gate, once per round)

> Found {N} comments on PR #{pr_number} (round {round.index}). Evaluation done. Review the suggested routing. Adjustments:
> - `accept` — proceed with suggested routing
> - `fix N` — promote a Decline/Clarify/NeedsCall item to FIX NOW
> - `decline N` — demote a FIX NOW item to DECLINE
> - `clarify N` — switch to clarification-reply mode
> - `defer N` — route to todo.md instead of fixing now
> - `show N` — print the full evaluation for item N (decision, causal chain, counter-argument, sources)
> - `fix all` — implement every ACCEPT item including Needs-your-call (skip per-item triage)
> - `stop` — keep the persisted routing-table plan artifact and emit the Execute This Plan handoff for a fresh session
>
> (accept = the plan gate's execute-now default / adjust = revise + re-persist / stop / show N / fix all)

If the user attempts to defer a Critical finding, execute the Critical Deferral Protocol from `commands/hatch3r-rework.md` §5b Routing ASK → Critical Deferral Protocol: structured warning + required written rationale + `Critical-deferred` tag in todo.md + flag for elevated visibility in the next board-fill.

On `accept` or `fix all` (the execute-now path), the round is autonomous through Step 9; Step 9.5 then gates any further round. On `stop`, the run halts before Step 6 — no implementation — and emits the In-Session Plan Gate stop outcome: the Execute This Plan handoff for a fresh session per `commands/shared/orchestration-frame.md` → In-Session Plan Gate, then the closing Iteration Summary.

#### 5d. File Deferred Findings to todo.md

If any findings route to DEFER, append a single epic-context block to `todo.md`:

```markdown
# Follow-ups from PR #{pr_number} pr-resolve ({date})
# Epic: group all items below into one epic during board-fill
- {comment author}: {finding description} (severity: {severity}, file: {file:line}) [ledger: {finding_id}]
- ...
```

Cache the deferred list. For each DEFER item, also append a `deferred` ledger row whose `closure_ref` is the item's todo.md anchor (`rules/hatch3r-findings-ledger.md`). Reply templates in Step 8 reference todo.md for these items.

---

## Step 6: Fix Implementation (Sub-Agent Delegation)

Delegate every FIX NOW finding to specialist sub-agents per the contract below (6a–6c): blast-radius-aware grouping, the full prompt-requirement list, and cross-agent conflict resolution.

#### 6a. Group Findings by Specialist

| Finding Category | Sub-Agent | Protocol |
|------------------|-----------|----------|
| Bugs, missing features, error handling, logic fixes | `hatch3r-implementer` | hatch3r-implementer agent protocol |
| Dead code, unused imports, type fixes, lint errors | `hatch3r-lint-fixer` | hatch3r-lint-fixer agent protocol |
| Missing tests, insufficient coverage | `hatch3r-testability` | hatch3r-testability agent protocol |

Blast-radius rule: same-file findings → same sub-agent (priority: hatch3r-implementer > hatch3r-lint-fixer > hatch3r-testability); disjoint files → parallel sub-agents.

#### 6b. Spawn Sub-Agents

Use the Task tool with `subagent_type: "generalPurpose"`. Launch independent groups in parallel.

Each sub-agent prompt MUST include:

1. The findings list for that agent: `(comment_id, file, line, comment body verbatim as the "ask", proposed_action from Step 4)`.
2. Instruction to follow the corresponding agent protocol.
3. All `scope: always` rule directives from `rules/`.
4. Acceptance criteria from `run_cache.pr.linked_issues` (read once at Step 1, cached).
5. Relevant `.hatch3r/learnings/` matching the affected areas.
6. Explicit: do NOT create branches, commits, or PRs.
7. Confidence expression requirement (verbatim from the Confidence Propagation Contract above).
8. PR-resolve-specific constraint: "You are addressing reviewer comments on an existing PR. Stay within the architecture established by the PR's existing changes; do not introduce scope creep beyond the comments listed below."

#### 6c. Await and Integrate

Await all sub-agents. Collect structured results: files changed, tests written, findings addressed, BLOCKED / PARTIAL items. Apply cross-agent conflict resolution when sub-agents modified overlapping files: **disjoint regions** (different functions/sections) — accept both change sets; **overlapping regions** (same function or block) — merge using the larger-scope change as the base, applying the smaller change on top, and present both versions to the user when the merge is ambiguous; **semantic conflicts** (contradictory logic) — never auto-resolve; surface both sub-agents' rationale in Step 10 Iteration Summary.

Update `run_cache.fix_results`.

---

## Step 7: Quality Verification

#### 7a. Quality Gates (before review loop)

1. Lint: project lint command (e.g., `npm run lint`).
2. Typecheck: project typecheck command (e.g., `npm run typecheck` or `npx tsc --noEmit`).
3. Tests: project test command (e.g., `npm test`).

If any gate fails, identify failures and either fix inline (single-line lint/type) or loop back to Step 6 with the specific failures as new findings. Max 2 retry loops; after 2 retries, record the failures in `run_cache.errors` and continue — the unresolved failures surface as a `Status: PARTIAL` in Step 10.

#### 7b. Review Loop (Tier 2/3 only; Tier 1 skips)

Run the Stage-1 review loop: spawn `hatch3r-reviewer`; on Critical/Warning findings spawn `hatch3r-fixer` with the reviewer output, then re-review (max 3 iterations, oscillation detection, confidence decay per `src/pipeline/reviewLoop.ts`; iterations >=2 re-review only changed hunks plus findings marked verify-fix — Medium/Low findings carry forward, not re-litigated; cap-out is an UNRESOLVED escalation, never silent continuation) — append the W1 write-ahead rows before the fixer dispatch and the W2 disposition rows after the re-review (`rules/hatch3r-findings-ledger.md` → Write Points). The reviewer prompt MUST include:
- The cached diff from Step 1e.
- All `scope: always` rule directives.
- Iteration number and prior findings.
- The Confidence expression requirement (verbatim).
- **Cross-PR Findings block (D13-SA13.1-F08).** Before the first reviewer spawn, scan `.hatch3r/review-findings/` (skip silently if the directory is absent) for entries whose `applies-to` glob matches any file in the cached diff; pass the 5 most-recent matches (by `created` descending) into the reviewer prompt as a `## Cross-PR Findings` block of `{id, applies-to, severity, pr, verdict, summary}` rows. The reviewer (which declares `consults_cross_pr_findings: true`) weighs these as prior organisational memory per its Cross-PR Finding Memory section. After the loop terminates clean, append one `.hatch3r/review-findings/<id>.md` entry per Critical/Warning finding resolved this run (atomic write via `src/merge/safeWrite.ts`), so the next PR on the same files inherits the memory — derive the entry from the ledger fold and cite its `finding_id` (`rules/hatch3r-findings-ledger.md` → Store Boundaries).

The reviewer's output MUST include a top-level `confidence: high | medium | low` so the gate evaluates pass/second_pass/escalate per `src/pipeline/reviewLoop.ts` semantics.

After the loop terminates, re-run Step 7a quality gates.

#### 7c. Final Quality Specialists (parallel)

After 7b is clean:

**Mandatory when code changed:**
- `hatch3r-testability` (CQ5) — verify tests for changed code paths meet the mandate map / coverage floor.
- `hatch3r-security` (CQ3) — security review of all changes.

**Mandatory-on-match (Tier 2/3):** when the round's diff matches a specialist's trigger row in the Phase 4 Specialist Trigger Table (`rules/hatch3r-agent-orchestration.md`), a dedicated instance MUST spawn — never merged into another spawn. Skipping a triggered one at Tier 2/3 is a gate failure.
- `hatch3r-ui` (CQ1) — UI component / theme / token files in the diff (`*.{tsx,jsx,vue,svelte}`, `tailwind.config.*`, design-token registries).
- `hatch3r-ux` (CQ2) — flow / modal / route-transition / error-state files in the diff; microcopy or i18n strings changed.

**Conditional:**
- `hatch3r-docs-writer` — when fixes touched public APIs, architectural patterns, or user-facing behavior.
- `hatch3r-performance` (CQ7) — when the diff includes hot-path changes (DB queries, API handlers, render loops).
- `hatch3r-lint-fixer` — when residual lint/type errors surfaced after Step 6.

Each specialist prompt MUST include: the agent protocol to follow (e.g., "Follow the hatch3r-testability agent protocol"), all `scope: always` rule directives from `rules/`, the diff or file changes to review, the linked issue's acceptance criteria (when available), the Confidence expression requirement (verbatim), and `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID). Apply specialist outputs; re-run 7a gates if changes were made.

---

## Step 8: Post Per-Comment Replies

For every finding in `run_cache.triage_decisions` (including DECLINE and DEFER buckets), draft and post one reply per the platform endpoint cached in `finding.reply_endpoint`.

#### 8a. Reply Template by Decision

| Decision | Template |
|----------|----------|
| FIX NOW — implemented | `Implemented in {commit_sha}: {one-line summary}. Confidence: {high|medium}.` |
| FIX NOW — failed (BLOCKED / PARTIAL) | `Attempted but blocked: {reason}. Tracked as {finding_id} in the findings ledger; follow-up in todo.md.` |
| DECLINE — outdated | `The code at this location has changed since this comment; the original concern no longer applies. Current behavior: {one-line summary}.` |
| DECLINE — disagree | `Considered, declining because: {reasoning from evaluation.causal_chain}. Counter-argument considered: {evaluation.counter_argument}. Happy to revisit if context differs.` |
| DECLINE — already done | `Already addressed in {commit_sha}: {one-line summary}.` |
| NEEDS_CLARIFICATION | `Couldn't fully validate this — could you confirm: {specific question derived from evaluation.bias_check}?` |
| DEFER | `Tracked as follow-up in todo.md for /hatch3r-board-fill triage.` |

All reply bodies are signed with a trailing line: `_— hatch3r-pr-resolve (confidence: {high|medium|low})_`. Reviewers can identify automated replies by this marker.

#### 8b. Per-Platform Endpoints

**GitHub:**
- Inline reply (to a thread): `gh api repos/{owner}/{repo}/pulls/{N}/comments -X POST -F in_reply_to={comment_id} -f body=@{tmp_file}`
- General discussion reply: `gh api repos/{owner}/{repo}/issues/{N}/comments -X POST -f body=@{tmp_file}`
- Review-summary reply: post as general discussion, quote the summary's first 200 characters at the top of the reply body.

**Azure DevOps:**
- Reply to thread: `az rest -m POST --url 'https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr}/threads/{threadId}/comments?api-version=7.1-preview.1' --body '{"parentCommentId":1,"content":"{body}","commentType":"text"}'`
- Non-threaded comment (general discussion equivalent): POST to `/threads` with a new thread containing one comment and no `threadContext`.

**GitLab:**
- Reply to discussion thread: `glab api '/projects/{project_id}/merge_requests/{iid}/discussions/{discussion_id}/notes' -X POST -f body=@{tmp_file}`
- General discussion (new note, no thread): `glab api '/projects/{project_id}/merge_requests/{iid}/notes' -X POST -f body=@{tmp_file}`

Reply bodies are written to a `mktemp` file and passed with `-f body=@{file}` (GitHub/GitLab) or via the JSON `--body` argument (Azure); this avoids shell-quoting issues with markdown content.

**Field typing for `gh api`:** Integer-typed fields like `in_reply_to` require `-F` (capital); string fields like `body` use `-f` (lowercase). Mixing them returns HTTP 422 and the reply silently fails into the retry/backoff path. See `commands/board/shared-github.md` → GitHub CLI Field-Typing Notes for the full table. **Pager:** Every `gh api` invocation from this command must run with `GH_PAGER=cat` and `PAGER=cat` set; see `commands/hatch3r-board-shared/SKILL.md` → Pager-Bypass Directive.

#### 8c. Resilience

Wrap each reply POST in retry-then-warn:
- 2 retries with 2s and 8s backoffs.
- On persistent failure, append to `run_cache.reply_post_results` with `status: failed` and the error; continue with the next reply.

Reply failures do NOT abort the run. The final state surfaces in the Step 10 Iteration Summary under `Not Done / Deferred / Unverified`.

#### 8d. Pre-Post Guards

- Reject reply bodies > 60000 bytes (well under platform limits; flag in `run_cache.errors` and post a truncated body with a `[truncated]` marker).
- Strip absolute paths matching `/Users/`, `/home/`, `C:\\Users\\` and any reference to `.audit-workspace/` or `.hatch3r/` internals.
- Never close threads (`gh api ... -X PATCH -f isResolved=true` and equivalents are forbidden).
- Never approve or dismiss the PR review (`gh pr review --approve`, `az repos pr set-vote`, `glab mr approve` are forbidden in this command).

---

## Step 9: Commit and Push

When `run_cache.fix_results.files_changed` is non-empty, stage, commit, and push.

**Pre-push re-check.** Immediately before `git push`, re-run the Step 1.6a detection recipe against `origin/{pr.baseRefName}`. Drift or new conflicts (base moved during the run) route back into the Step 1.6 flow — 1.6b table, 1.6c bundled ASK, 1.6d fixer delegation + verification — then return here and push. Step 1.6 owns the table spec and consent UX; this re-check adds no second copy.

```bash
git add -A
git commit -m "$(cat <<'EOF'
pr-resolve: address {fixed_n} comments on PR #{N} ({declined_n} declined, {deferred_n} deferred)

Fixed:
- {comment_id} by @{author}: {one-line summary}
- ...

Declined with rationale (replied on PR):
- {comment_id} by @{author}: {one-line summary}

Deferred to todo.md for /hatch3r-board-fill:
- {comment_id} by @{author}: {one-line summary}

Refs #{linked_issue_n}, ...
EOF
)"
git push
```

If `git push` fails because the remote branch does not exist, run `git push -u origin {branch}`.

If `run_cache.fix_results.files_changed` is empty (every comment was DECLINE / DEFER / NEEDS_CLARIFICATION), skip the commit and push — Step 8 replies are the only artifact produced.

**Post-commit board update (Tier 3 only).** When board context exists and Tier 3 was assigned, append a pr-resolve summary section to the PR description ({date}, fixed findings with severities, deferred-to-todo.md list, quality agents spawned, overall confidence). Do NOT change issue status labels, and do NOT modify `Closes #N` / `Relates to #N` references — the originals from board-pickup stay authoritative. For Tier 1/2, skip.

---

## Step 9.5: Re-Poll Gate (ask each round)

Runs after every Step 9 push. Skipped when Step 9 was skipped — no new HEAD means AI review tools have nothing new to review. Round state lives in `run_cache.round` and persists to the checkpoint (`roundIndex`, `roundStartedAt`).

#### 9.5a. ASK (re-poll consent)

> Pushed {sha} to PR #{N} (round {round.index}). AI review tools (CodeRabbit, Copilot code review, etc.) may post new comments on the new HEAD within a few minutes. Poll for comments created after {round.started_at} and resolve them in another round? (poll / done)

- `done` → proceed to Step 10.
- `poll` → run 9.5b.

#### 9.5b. Poll

Re-issue the Step 2 fetch (all scopes) every 60s, max 5 attempts (~300s budget). Retain only comments where ALL three hold:

1. `created_at > round.started_at`.
2. `comment_id` absent from checkpoint `postedCommentIds` — already-replied threads are never re-processed.
3. Thread not resolved (the guardrail 9 filter).

**New comments retained:** increment `round.index`, reset `round.started_at` to now, append the retained count to `round.comments_per_round`, refresh the Step 1e diff against the new HEAD, and re-enter at Step 2 scoped to the retained set. The round runs Steps 2–9 in full — normalize, evaluate, Step 5 triage ASK, fix, verify, reply, commit + push — then returns to 9.5a.

**Zero retained after 5 attempts:** report "No new comments after 300s." and re-ask 9.5a (keep polling / done).

There is no automatic round cap — the 9.5a ASK is the bound; every round is user-approved.

---

## Step 10: Resolution Summary

Reconcile the findings ledger to the run-exit invariant (W3, `rules/hatch3r-findings-ledger.md`): zero rows may fold `pending`/`in-fix`; open Critical/Warning force an ASK; unattended runs record them as `escalated` and exit PARTIAL.

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md` — a 1–2 line recap plus every exception line whose firing condition holds, using the closed Status enum. Disposition mapping: DEFER dispositions land on the `Not done:` line; NEEDS_CLARIFICATION items land on the `Blockers:` line; a declined Step 1.6 sync gate puts its warning line on the `Blockers:` line. Recap facets include `rounds {n}` (from `round.index`); when rounds > 1, a `Rounds:` exception line enumerates per-round counts sourced from `round.comments_per_round`. Worked example:

```markdown
## Iteration Summary
**PARTIAL** — Resolved 11 of 13 comments on PR #142 across 2 rounds; replies posted; commits pushed.
files 6 (+184/−42) · sa 7/10 · gates 6/6 · cost Δ−12% tok / Δ+8% min · tier 2 · rounds 2
Rounds: r1 10 comments (8 fixed) · r2 3 comments (3 fixed)
Not done: c-214 @maya DEFER — deferred: tracked in todo.md for /hatch3r-board-fill
Blockers: c-207 @jordan NEEDS_CLARIFICATION — awaiting reviewer response
Confidence: medium — reviewer loop clean after 1 round; 2 comments unresolved. The fix required one round of corrections, which is normal for moderately complex changes. A brief human review is recommended.
Next: re-run /hatch3r-pr-resolve when the reviewer answers c-207.

## Remaining Work

Not done: c-214 @maya DEFER — deferred: tracked in todo.md for /hatch3r-board-fill
Blockers: c-207 @jordan NEEDS_CLARIFICATION — awaiting reviewer response
```

Status decision rules:
- **SUCCESS** — every FIX NOW finding implemented, all replies posted, all gates green.
- **PARTIAL** — some FIX NOW findings BLOCKED/PARTIAL, OR some replies failed to post, OR Step 7a gates ended on a retry-limit miss.
- **FAILED** — Step 6 sub-agents all returned BLOCKED, no code changed, replies could not be drafted.
- **BLOCKED** — cannot proceed without user input (e.g., Critical-deferred rationale not provided, semantic conflict requiring a design decision).

---

## Resumability (Decision 27/30)

pr-resolve is long-running — a Tier 3 PR with many open comments runs identity resolution (Step 1), the base-branch sync gate (Step 1.6), full-platform comment fetch (Step 2), normalization + rigor-contract evaluation (Steps 3–4), the comment-resolution mutation-gate ASK (Step 5), parallel-per-finding fix implementation (Step 6), the reviewer ↔ fixer review loop + Phase 4 specialist batch (Step 7), per-comment platform-API replies (Step 8), commit + push (Step 9), and the Step 9.5 re-poll gate, which can add further full rounds. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-fetching comments, re-evaluating findings, or re-posting platform-API replies that already shipped.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.pr-resolve-workspace/`; step range Step 0 → Step 10 with a Step 9.5 loop-back to Step 2; `wave` = per-finding fix-batch index in Step 6 and review-loop iteration index in Step 7a; snapshot/rollback paths pre-commit working-tree state and the per-comment reply attempt log; checkpoint meta gains `roundIndex` + `roundStartedAt`. Write points: after Step 1 PR identity resolves, after a Step 1.6 sync gate resolves (`sync_gate` outcome + per-file resolutions and proof ids persist), after Step 2 comment fetch locks the normalizedFindings input, after Step 3 normalization, after Step 4 rigor-contract evaluation, after the Step 5 ASK checkpoint (comment-resolution mutation gate — confirmed routing decisions and the Tier >= 2 plan-gate artifact path + approval persist so resume does not re-prompt), after each Step 6 per-finding implementer/lint-fixer/testability batch returns, after each Step 7a review-loop iteration, after each Step 7b–7c specialist batch returns, after each Step 8 platform-API reply records its commentId in `postedCommentIds` (the resume path skips replies with an entry there — no double-posts), after Step 9 commit + push, and after each Step 9.5 decision (round counter + `roundStartedAt` persist; the `postedCommentIds` filter carries across rounds).

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for pr-resolve: `1` = comment fetch + triage classification, `2` = per-comment researcher/implementer/fixer dispatch, `3` = reply drafting + reviewer verdict, `4` = posting + Step 10 resolution-summary + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: PR file changes, reply drafts, status updates.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28). (The Step 10 block above is the domain rendering; the recap closes the run.)

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; both land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the Step 5 ASK gate (the comment-resolution mutation gate; fan-out begins in Step 6). Each Step 9.5 re-poll round re-emits it before that round's Step 5 ASK — re-entry passes through Step 4e → Step 5, so the per-round estimate fires on the same path.
- **Post-execution `cost_actuals` + `delta`** — appended to the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 10` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 1 (one specialist, no review loop); Tier 2 ≈ 4 (FIX NOW fix group + review loop); Tier 3 up to 10 (full pipeline including the parallel Tier-3 final-quality specialist mandate and both mandatory-on-match specialists when triggered). A no-comment short-circuit (Step 2d) emits `actual_sa_count: 0`. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| PR not found and no number supplied | Halt with the Step 1d actionable error; exit code 2. |
| Zero unresolved comments | Step 2d short-circuit → Step 10 SUCCESS, no commit. |
| Platform CLI not authenticated | Halt with platform-specific recovery (`gh auth login`, `az login`, `glab auth login`); exit code 1. |
| Referenced file in a comment does not exist | Set `evaluation.decision: NEEDS_CLARIFICATION`, reply asks reviewer for the correct path. |
| Sub-agent (Step 6) reports BLOCKED on a finding | Skip the finding for FIX NOW; surface in Step 10 `Not Done`; reply with "Attempted but blocked" template. |
| Sub-agent (Step 6) returns PARTIAL | Apply partial changes; mark the unaddressed sub-findings as deferred; reply notes partial implementation. |
| Reply POST persistently fails (Step 8c) | Continue run; record in `run_cache.reply_post_results`; surface in Step 10. |
| Review loop hits 3 iterations with findings remaining | Cap-out is an UNRESOLVED escalation, never silent continuation — ASK the user how to proceed; the ASK lists the open `finding_id`s with legal closures; reconcile the ledger to the run-exit invariant (W3, `rules/hatch3r-findings-ledger.md`) on exit. |
| Quality gate fails 2 retries (Step 7a) | Record in `run_cache.errors`; Step 10 `Status: PARTIAL`. |
| `git push` rejected (e.g., upstream changed mid-run) | Route into the Step 1.6 gate flow: re-run the 1.6a recipe with `origin/{pr.headRefName}` as the comparison ref, present the 1.6b table + 1.6c bundled ASK, resolve via 1.6d, then retry the push once. A second rejection halts with `Status: BLOCKED` and the recorded `sync_gate` state. |
| Step 9.5 poll budget exhausted (5 × 60s) with zero new comments | Report "No new comments after 300s."; re-ask 9.5a (keep polling / done). |
| GraphQL `reviewThreads` query fails (GitHub resolution state) | Fall back to evaluating every inline comment (no resolution filter); record a Low-confidence note in `run_cache.errors`. |

---

## Guardrails

1. **Three ASK gate classes.** Step 1.6 (sync consent, only when the 1.6a probe detects drift or conflicts), Step 5 (triage routing, once per round), and Step 9.5 (re-poll consent, after each push) are the only user-facing checkpoints. Within a round, after `accept` Steps 6–9 run without further prompting (per user decision); the Step 9 pre-push re-check re-opens the Step 1.6 ASK only when base moved mid-run.
2. **No thread closure.** Never mark a thread resolved (`isResolved: true`, Azure `status: fixed`, GitLab `resolved: true`). Thread resolution is reviewer-owned semantics.
3. **No review verdicts.** Never approve, dismiss, or request changes on a PR review. Reply-only.
4. **No labels or status checks.** PR labels and status checks are out of scope (handled by `hatch3r-board-fill` and CI integrations).
5. **No cross-PR work.** One PR per invocation. The `<pr-number>` argument is bound to a single PR. Step 9.5 rounds iterate on the same PR only — a re-poll never widens scope to another PR.
6. **No base-branch push.** Step 9 pushes only to `pr.headRefName`. Refuse if the current branch differs.
7. **Reply body hygiene.** Strip internal paths (`/Users/`, `/home/`, `.audit-workspace/`, `.hatch3r/`). Truncate over 60000 bytes.
8. **Bot-comment parity.** Per user decision, comments from bot accounts are evaluated under the same rigor contract as human comments — no special-case skipping or downgrading.
9. **Skip resolved by default.** Step 2 filters resolved threads (`isResolved` for GitHub, `status: fixed/closed` for Azure, `resolved: true` for GitLab) unless a future flag explicitly opts in. Re-poll rounds (Step 9.5b) additionally exclude comments whose `comment_id` is in checkpoint `postedCommentIds`.
10. **Confidence propagation.** Every reply body, every triage row, every Step 10 verdict carries a confidence rating from the upstream sub-agent or evaluation. Dropping the signal is a gate failure.

## References

- `agents/shared/user-question-protocol.md` (B1 gate — applies at §0 Detect Ambiguity above plus the Step 1.6 sync ASK and Step 5 ASK gates per Finding D7-M14)
- `agents/shared/quality-charter.md` §1, §3, §7, §8 (confidence, ambiguity, measurable criteria)
- `rules/hatch3r-agent-orchestration.md` (Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive)
