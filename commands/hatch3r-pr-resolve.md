---
id: hatch3r-pr-resolve
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-lint-fixer, hatch3r-testability, hatch3r-reviewer, hatch3r-fixer, hatch3r-security, hatch3r-docs-writer, hatch3r-ui, hatch3r-performance]
description: "Read open PR comments, evaluate each against current code via the rigor contract, implement accepted findings, reply inline. Multi-platform."
tags: [implementation, review, ctx:team-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 9
  rationale: Per-PR fanout — implementer, lint-fixer, testability (CQ5, FIX NOW group, parallel), reviewer ↔ fixer review loop (max 3 iterations), then parallel Tier-3 final-quality specialists (security (CQ3), docs-writer, ui (CQ1), performance (CQ7)) per the Tier-3 specialist mandate. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Identify PR | Orchestrator (inline) | No | Yes |
| 2. Fetch comments | Orchestrator (inline, platform CLI) | Per scope | Yes |
| 3. Normalize | Orchestrator (inline) | No | Yes |
| 4. Evaluate (rigor contract) | Orchestrator (inline) | Per finding | Yes |
| 5. Triage routing + ASK gate | Orchestrator (inline) | No | Yes |
| 6. Fix implementation | `hatch3r-implementer`, `hatch3r-lint-fixer`, `hatch3r-testability` | Per finding group | When FIX NOW items exist |
| 7a. Review loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | When code changed (Tier 2/3) |
| 7b. Final quality — mandatory | `hatch3r-testability`, `hatch3r-security` | Yes | When code changed |
| 7c. Final quality — conditional | `hatch3r-docs-writer`, `hatch3r-ui`, `hatch3r-performance`, `hatch3r-lint-fixer` | Yes | When triggered |
| 8. Post replies | Orchestrator (inline, platform CLI) | Per comment | Yes |
| 9. Commit and push | Orchestrator (inline) | No | When code changed |
| 10. Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

---

# PR Resolve -- Read, Evaluate, Implement, and Reply

Closes the **reviewer -> contributor** loop on an open PR. Fetches every comment (inline review comments + review summaries + general PR discussion), evaluates each against current code using the Scientific Rigor Contract, presents one consolidated triage ASK, then runs autonomously: delegates fixes to specialist sub-agents, runs the review-loop + final-quality pipeline, posts a per-comment reply with rationale, and commits.

Use `hatch3r-pr-resolve` when reviewer feedback exists on a PR you want to address. Use `hatch3r-revision` when the feedback comes from you in a fresh window with no PR comments to read. Use `hatch3r-board-fill` to triage `todo.md` items into a project board.

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

1. **One fetch per comment scope.** Issue exactly one paginated request per scope in Step 2; cache and reuse for Steps 3, 4, and 8.
2. **One diff computation.** Compute `git diff {defaultBranch}...HEAD` once in Step 1; reuse for Steps 4 (outdated detection) and 7 (review loop input).
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
  errors: [<error_record>, ...]
```

---

## Workflow

Execute these steps in order. **Do not skip any step.** The only ASK gate is Step 5; after the user accepts triage, run autonomously through Step 10.

---

## Step 0: Triage

Classify the run before delegating. Counts and severity come from the Step 4 evaluation, so reorder if needed — for runs with no comments at all, take the early-exit path in Step 2.

- **Tier 1** (≤5 comments, all single-line nits, 0 critical, 0 architectural-discussion items): reduced pipeline — implement inline or via one specialist; skip Step 7a review loop; still run Step 7b mandatory specialists (hatch3r-testability, hatch3r-security).
- **Tier 2** (6–30 comments, mixed severity, no critical disagreements or design objections): standard pipeline — Steps 6, 7a (review loop, max 3 iterations), 7b mandatory + 7c triggered.
- **Tier 3** (>30 comments OR any Critical-severity item OR any architectural-discussion item OR cross-cutting changes): full pipeline + merge-readiness assessment after Step 9.

Tier assignment is recomputed after Step 4 (when severity is known). If the initial Step 0 read of raw counts says Tier 1 but Step 4 reveals a Critical-severity item, upgrade to Tier 3 before the Step 5 ASK.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 5 ASK gate (the only mutation gate, after which fan-out begins in Step 6), surface the cost preview so a large comment-resolution run is never approved blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 tier (recomputed in Step 4e once severities are known). A PR with zero unresolved comments short-circuits at Step 2d and spawns nothing, so `expected_sa_count: 0` is correct for that case.

```yaml
cost_estimate:
  expected_sa_count: <tier → Tier 1 ~1, Tier 2 ~4, Tier 3 up to 9; 0 when no unresolved comments>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 10 Resolution Summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a 40-comment PR of pure nits scored as Tier 3, or a 3-comment PR with a hidden Critical scored as Tier 1. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0/Step 4e auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- The override does NOT suppress the Critical-severity upgrade: a `--effort=light` run that surfaces a Critical item in Step 4 still runs the Tier-3 specialist mandate (Step 5). Safety dominates the cost override.
- No override passed → the Step 0/Step 4e auto-classification stands.

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

**Severity heuristic** (matches `commands/hatch3r-revision.md` triage table):
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

**Tier-3 specialist mandate (P8 B2).** For Tier 3 PRs (6+ findings OR any Critical severity), the post-fix specialist pass (`hatch3r-testability`, `hatch3r-security`, `hatch3r-docs-writer`) MUST run in parallel. Specialists may NOT be deferred via "Needs your call" for cost reasons. Cost-dominance principle applies: token cost of specialist sub-agents is dominated by the quality gain of catching defects pre-merge.

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

#### 5c. ASK (only gate)

> Found {N} comments on PR #{pr_number}. Evaluation done. Review the suggested routing. Adjustments:
> - `accept` — proceed with suggested routing
> - `fix N` — promote a Decline/Clarify/NeedsCall item to FIX NOW
> - `decline N` — demote a FIX NOW item to DECLINE
> - `clarify N` — switch to clarification-reply mode
> - `defer N` — route to todo.md instead of fixing now
> - `show N` — print the full evaluation for item N (decision, causal chain, counter-argument, sources)
> - `fix all` — implement every ACCEPT item including Needs-your-call (skip per-item triage)
>
> (accept / adjust / show N / fix all)

If the user attempts to defer a Critical finding, execute the Critical Deferral Protocol from `commands/hatch3r-revision.md` §5b Routing ASK → Critical Deferral Protocol: structured warning + required written rationale + `Critical-deferred` tag in todo.md + flag for elevated visibility in the next board-fill.

After the user accepts, the run is autonomous until Step 10.

#### 5d. File Deferred Findings to todo.md

If any findings route to DEFER, append a single epic-context block to `todo.md`:

```markdown
# Follow-ups from PR #{pr_number} pr-resolve ({date})
# Epic: group all items below into one epic during board-fill
- {comment author}: {finding description} (severity: {severity}, file: {file:line})
- ...
```

Cache the deferred list. Reply templates in Step 8 reference todo.md for these items.

---

## Step 6: Fix Implementation (Sub-Agent Delegation)

Delegate every FIX NOW finding to specialist sub-agents using the delegation contract from `commands/revision/revision-delegation.md` (§6a–6c). Same blast-radius-aware grouping, same prompt requirements.

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

Await all sub-agents. Collect structured results: files changed, tests written, findings addressed, BLOCKED / PARTIAL items. Apply cross-agent conflict resolution per `commands/revision/revision-delegation.md` §6c → Cross-Agent Conflict Resolution (disjoint regions accept both; overlapping regions merge larger-scope; semantic conflicts surface in Step 10 Iteration Summary).

Update `run_cache.fix_results`.

---

## Step 7: Quality Verification

#### 7a. Quality Gates (before review loop)

1. Lint: project lint command (e.g., `npm run lint`).
2. Typecheck: project typecheck command (e.g., `npm run typecheck` or `npx tsc --noEmit`).
3. Tests: project test command (e.g., `npm test`).

If any gate fails, identify failures and either fix inline (single-line lint/type) or loop back to Step 6 with the specific failures as new findings. Max 2 retry loops; after 2 retries, record the failures in `run_cache.errors` and continue — the unresolved failures surface as a `Status: PARTIAL` in Step 10.

#### 7b. Review Loop (Tier 2/3 only; Tier 1 skips)

Spawn `hatch3r-reviewer` -> `hatch3r-fixer` per `commands/revision/revision-quality.md` Stage 1 (max 3 iterations, oscillation detection, confidence decay). The reviewer prompt MUST include:
- The cached diff from Step 1e.
- All `scope: always` rule directives.
- Iteration number and prior findings.
- The Confidence expression requirement (verbatim).
- **Cross-PR Findings block (D13-SA13.1-F08).** Before the first reviewer spawn, scan `.hatch3r/review-findings/` (skip silently if the directory is absent) for entries whose `applies-to` glob matches any file in the cached diff; pass the 5 most-recent matches (by `created` descending) into the reviewer prompt as a `## Cross-PR Findings` block of `{id, applies-to, severity, pr, verdict, summary}` rows. The reviewer (which declares `consults_cross_pr_findings: true`) weighs these as prior organisational memory per its Cross-PR Finding Memory section. After the loop terminates clean, append one `.hatch3r/review-findings/<id>.md` entry per Critical/Warning finding resolved this run (atomic write via `src/merge/safeWrite.ts`), so the next PR on the same files inherits the memory.

The reviewer's output MUST include a top-level `confidence: high | medium | low` so the gate evaluates pass/second_pass/escalate per `src/pipeline/reviewLoop.ts` semantics.

After the loop terminates, re-run Step 7a quality gates.

#### 7c. Final Quality Specialists (parallel)

After 7b is clean:

**Mandatory when code changed:**
- `hatch3r-testability` (CQ5) — verify tests for changed code paths meet the mandate map / coverage floor.
- `hatch3r-security` (CQ3) — security review of all changes.

**Conditional:**
- `hatch3r-docs-writer` — when fixes touched public APIs, architectural patterns, or user-facing behavior.
- `hatch3r-ui` (CQ1) — when the diff includes UI component or style files.
- `hatch3r-performance` (CQ7) — when the diff includes hot-path changes (DB queries, API handlers, render loops).
- `hatch3r-lint-fixer` — when residual lint/type errors surfaced after Step 6.

Each specialist prompt mirrors the requirements in `commands/revision/revision-quality.md` §Stage 2 → Specialist Prompt Requirements (agent protocol, scope:always rules, diff, acceptance criteria, confidence requirement). Apply specialist outputs; re-run 7a gates if changes were made.

---

## Step 8: Post Per-Comment Replies

For every finding in `run_cache.triage_decisions` (including DECLINE and DEFER buckets), draft and post one reply per the platform endpoint cached in `finding.reply_endpoint`.

#### 8a. Reply Template by Decision

| Decision | Template |
|----------|----------|
| FIX NOW — implemented | `Implemented in {commit_sha}: {one-line summary}. Confidence: {high|medium}.` |
| FIX NOW — failed (BLOCKED / PARTIAL) | `Attempted but blocked: {reason from sub-agent}. Surfaced as follow-up in todo.md.` |
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

**Post-commit board update (Tier 3 only).** When board context exists and Tier 3 was assigned, update the PR description with a pr-resolve summary per `commands/revision/revision-board-integration.md`. For Tier 1/2, skip.

---

## Step 10: Resolution Summary

Emit the canonical Iteration Summary block from `rules/hatch3r-iteration-summary.md`. Use the exact field names and the closed Status enum.

```markdown
## Iteration Summary

**Status:** SUCCESS | PARTIAL | FAILED | BLOCKED
**Outcome:** {one sentence — e.g., "Resolved 8 of 10 comments on PR #142; 2 deferred; replies posted."}

**Done:**
- {comment_id} @{author}: FIX NOW → implemented in {commit_sha}
- {comment_id} @{author}: DECLINE (outdated) → reply posted
- ...

**Not Done / Deferred / Unverified:**
- {comment_id} @{author}: DEFER → tracked in todo.md
- {comment_id}: reply post failed (Azure REST 429); manual follow-up needed
- (or: `None — full scope completed`)

**Open Questions / Blockers:**
- {comment_id} @{author}: NEEDS_CLARIFICATION → awaiting reviewer response
- (or: `None`)

**Confidence:** {high | medium | low} — {one-sentence basis from sub-agent outputs and reviewer verdict}

**Artifacts Touched:**
| Path | Action | Notes |
| ---- | ------ | ----- |
| {file} | modified | {one line} |

**Verifications Run:**
| Check | Result |
| ----- | ------ |
| lint | pass |
| typecheck | pass |
| tests | pass ({n} passed) |
| reviewer/fixer loop | clean after {n} iteration(s) |
| hatch3r-security | pass |
| hatch3r-testability | pass — added {n} test(s) |

**Suggested Next Action:** {one line — e.g., "Wait for reviewer response on the 2 NEEDS_CLARIFICATION items, then re-run /hatch3r-pr-resolve."}
```

Status decision rules:
- **SUCCESS** — every FIX NOW finding implemented, all replies posted, all gates green.
- **PARTIAL** — some FIX NOW findings BLOCKED/PARTIAL, OR some replies failed to post, OR Step 7a gates ended on a retry-limit miss.
- **FAILED** — Step 6 sub-agents all returned BLOCKED, no code changed, replies could not be drafted.
- **BLOCKED** — cannot proceed without user input (e.g., Critical-deferred rationale not provided, semantic conflict requiring a design decision).

---

## Resumability (Decision 27/30)

pr-resolve is long-running — a Tier 3 PR with many open comments runs identity resolution (Step 1), full-platform comment fetch (Step 2), normalization + rigor-contract evaluation (Steps 3–4), the only mutation-gate ASK (Step 5), parallel-per-finding fix implementation (Step 6), the reviewer ↔ fixer review loop + Phase 4 specialist batch (Step 7), per-comment platform-API replies (Step 8), and commit + push (Step 9). Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-fetching comments, re-evaluating findings, or re-posting platform-API replies that already shipped.

**Checkpoint contract** (`src/pipeline/checkpoint.ts`):

1. **Workspace + file:** write `.pr-resolve-workspace/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (the Step 0 → Step 10 progression), `wave` (per-finding fix-batch index in Step 6 and review-loop iteration index in Step 7a), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, prNumber, normalizedFindings, postedCommentIds, branchName }` where `postedCommentIds` is the set of comment IDs already replied to (idempotency guard for Step 8).
2. **Write points:** after Step 1 PR identity resolves, after Step 2 comment fetch locks the normalizedFindings input, after Step 3 normalization, after Step 4 rigor-contract evaluation, after the Step 5 ASK checkpoint (only mutation gate — confirmed routing decisions persist so resume does not re-prompt), after each Step 6 per-finding implementer/lint-fixer/testability batch returns, after each Step 7a review-loop iteration, after each Step 7b–7c specialist batch returns, after each Step 8 platform-API reply records its commentId in `postedCommentIds` (the resume path skips replies with an entry there — no double-posts), and after Step 9 commit + push.
3. **`--resume` invocation:** `hatch3r pr-resolve --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (PR head SHA / branch HEAD / new comments since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline; new PR comments since the checkpoint force a cold start so the rigor-contract evaluation covers the full set. A `failed` status halts for operator triage before resuming.
4. **Snapshot rollback:** pre-mutation snapshots of pre-commit working-tree state and the per-comment reply attempt log land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's filesystem mutations (posted platform replies remain a manual revert via the platform CLI — `gh pr review --dismiss`, `az repos pr update`, etc., since they are platform mutations outside the snapshot scope). Diff preview precedes every file write per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for pr-resolve: `1` = comment fetch + triage classification, `2` = per-comment researcher/implementer/fixer dispatch, `3` = reply drafting + reviewer verdict, `4` = posting + Step 10 resolution-summary + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (PR file changes, reply drafts, status updates) at Tier 2 or Tier 3 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by each spawned sub-agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path or comment ref>: via hatch3r-{implementer|fixer|reviewer} (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output (the Step 10 Resolution Summary block above adapts these sections to the PR-resolution domain — both the Step 10 block and the 9-section canonical contract apply). The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

The 9 sections:

1. **Request** — verbatim restatement of the user's ask in one sentence.
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` plus the `cost_estimate` / `cost_actuals` / `delta` blocks (see Cost Visibility below).
3. **Web Research** — every URL fetched with access date + trust tier per `agents/shared/rigor-contract.md` (0 acceptable when no research was needed).
4. **Files Mutated** — list with diff summary (lines added / removed / files created).
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist.
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per CONSTITUTION §6 Decision 17.
7. **Verification Commands** — exact commands run with exit codes plus key output lines (≤200 chars).
8. **Open Questions / Blockers** — explicit `None` if fully closed.
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run per `rules/hatch3r-learning-system.md`.

### Cost Visibility (Decision 24)

Pre-execution: emit `cost_estimate` before the first sub-agent dispatch via `src/pipeline/observability.ts::buildCostBlock` (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  triage_tier: light | standard | deep
  estimated_web_research_queries: <int>      # 0 when no research is needed
  estimated_duration_min: <int>
```

Post-execution: call `buildCostBlock` again with actuals to emit `cost_actuals` + `delta`; both land in Section 2 above. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the Step 5 ASK gate (the only mutation gate; fan-out begins in Step 6).
- **Post-execution `cost_actuals` + `delta`** — appended to the Step 10 Resolution Summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 9` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 1 (one specialist, no review loop); Tier 2 ≈ 4 (FIX NOW fix group + review loop); Tier 3 up to 9 (full pipeline including the parallel Tier-3 final-quality specialist mandate). A no-comment short-circuit (Step 2d) emits `actual_sa_count: 0`. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

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
| Review loop hits 3 iterations with findings remaining | ASK the user per `commands/revision/revision-quality.md` §Stage 1 Review Loop step 3 (3-iteration ASK). |
| Quality gate fails 2 retries (Step 7a) | Record in `run_cache.errors`; Step 10 `Status: PARTIAL`. |
| `git push` rejected (e.g., upstream changed mid-run) | Halt at Step 9 with: "Remote branch changed during run. Run `git pull --rebase`, resolve conflicts, then re-run /hatch3r-pr-resolve to repost any failed replies." |
| GraphQL `reviewThreads` query fails (GitHub resolution state) | Fall back to evaluating every inline comment (no resolution filter); record a Low-confidence note in `run_cache.errors`. |

---

## Guardrails

1. **One ASK gate.** Step 5 is the only user-facing checkpoint. After `accept`, the run proceeds through Steps 6–10 without further prompting (per user decision).
2. **No thread closure.** Never mark a thread resolved (`isResolved: true`, Azure `status: fixed`, GitLab `resolved: true`). Thread resolution is reviewer-owned semantics.
3. **No review verdicts.** Never approve, dismiss, or request changes on a PR review. Reply-only.
4. **No labels or status checks.** PR labels and status checks are out of scope (handled by `hatch3r-board-fill` and CI integrations).
5. **No cross-PR work.** One PR per invocation. The `<pr-number>` argument is bound to a single PR.
6. **No base-branch push.** Step 9 pushes only to `pr.headRefName`. Refuse if the current branch differs.
7. **Reply body hygiene.** Strip internal paths (`/Users/`, `/home/`, `.audit-workspace/`, `.hatch3r/`). Truncate over 60000 bytes.
8. **Bot-comment parity.** Per user decision, comments from bot accounts are evaluated under the same rigor contract as human comments — no special-case skipping or downgrading.
9. **Skip resolved by default.** Step 2 filters resolved threads (`isResolved` for GitHub, `status: fixed/closed` for Azure, `resolved: true` for GitLab) unless a future flag explicitly opts in.
10. **Confidence propagation.** Every reply body, every triage row, every Step 10 verdict carries a confidence rating from the upstream sub-agent or evaluation. Dropping the signal is a gate failure.

## References

- `agents/shared/user-question-protocol.md` (B1 gate — applies at §0 Detect Ambiguity above plus the Step 5 ASK gate per Finding D7-M14)
- `agents/shared/quality-charter.md` §1, §3, §7, §8 (confidence, ambiguity, measurable criteria)
- `rules/hatch3r-agent-orchestration.md` (Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive)
