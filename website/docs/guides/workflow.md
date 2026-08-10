---
sidebar_position: 1
title: Workflow
---

# Workflow

hatch3r provides a full project lifecycle, from setup to release. This guide walks through the typical flow and links to the deeper view of the four-phase pickup pipeline and review loop.

:::info Last verified
2026-06-11 against hatch3r 2.0.0. The init flow described in Step 1 mirrors the canonical prompt order in `src/cli/commands/init.ts`; the copy-paste-runnable version lives in the [Quick Start](../getting-started/quick-start). Re-verified each audit cycle (P3 — Adapter & MCP Currency).
:::

## 1. Initialize

```bash
npx hatch3r init
```

Interactive setup (~2 minutes) detects your repository from its git remote and walks a short prompt sequence. On a fresh GitHub greenfield repo it asks 7 prompts:

1. **Platform** — GitHub, Azure DevOps, or GitLab, auto-detected from your git remote (press Enter to accept).
2. **Repo identity** — owner + repo (GitHub), namespace + project (GitLab), or org + project + repo (Azure DevOps), auto-filled from the remote where possible.
3. **Content profile** — `minimal`, `standard` (recommended), `full`, or `custom` (a `custom` pick adds one item-picker prompt).
4. **Project maturity** — `solo` / `team` / `scaleup` / `enterprise` investment dial, seeded at a git-inferred default. Skipped when you pass `--maturity`.
5. **Communication style** — `plain` (default) or `technical` operator register for generated-agent output. Skipped when you pass `--communication-style` or run headless/`--resume`.
6. **Tools** — multi-select from the four supported adapters (Claude Code, Cursor, Copilot, Codex).
7. **CLI tools** — tier-grouped picker (tier-1 + trigger-matched tier-2 pre-checked; enter-through equals the `--yes` smart default). MCP is not prompted — opt in with `npx hatch3r init --mcp` or `npx hatch3r mcp setup` later.

Default branch, project type (greenfield/brownfield), and team size (solo/team) are **inferred, not prompted** — branch from git, the others from repository signals. If detected CLI tools are missing from PATH, hatch3r prints copy-paste install commands and adds one `Mark these tools as 'install pending' and continue?` confirm. Headless `--yes` skips every prompt and falls back to the CLI-tools smart default.

:::tip CLI tools default-on since 1.7.5
hatch3r's 39-tool catalog is delivered as 5 standalone per-tool skills plus 34 toolbox sections. Tier 1 enables 11 tools by default; Tier 2 conditionally selects 13; Tier 3 offers 15 opt-in tools. MCP is opt-in. See [CLI Tools](../getting-started/cli-tools) for the catalog, decision tree, and trade-off discussion.
:::

**Next steps after init:**

Claude Code, Cursor, and GitHub Copilot use the slash forms below. Codex has no repository-defined slash-command surface, so each example includes its generated `$hatch3r-command-*` skill bridge.

| Starting point | Slash command | Codex | What it does |
|----------------|---------------|-------|-------------|
| Full project (either kind) | `/hatch3r-spec` | `$hatch3r-command-spec` | Auto-detects greenfield vs brownfield and runs the matching spec flow |
| Single feature | `/hatch3r-feature-plan` | `$hatch3r-command-feature-plan` | Plan one feature with parallel researchers — no board needed |
| Tiny change | `/hatch3r-quick-change` | `$hatch3r-command-quick-change` | One-shot flow for a typo, config tweak, or one-file refactor |

### Full project (greenfield or brownfield)

1. Run `/hatch3r-spec` (Codex: `$hatch3r-command-spec`) -- on a new project it generates specs from your vision; on an existing codebase it reverse-engineers specs from the current code. It picks the branch by detecting project state, so you do not choose greenfield vs brownfield yourself. Produces spec deliverables under `docs/specs/` (it does not emit `docs/adr/` or `todo.md` -- the `/hatch3r-roadmap` step below uses `$hatch3r-command-roadmap` in Codex, reads `docs/specs/`, and produces the `todo.md`).
2. Run `/hatch3r-roadmap` (Codex: `$hatch3r-command-roadmap`) to refine the plan into dependency-ordered epics broken into milestones.
3. Continue with board fill (step 4 below).

To force one branch, the split commands remain as a legacy path: `/hatch3r-project-spec` (Codex: `$hatch3r-command-project-spec`, greenfield only) or `/hatch3r-codebase-map` (Codex: `$hatch3r-command-codebase-map`, brownfield only), each followed by `/hatch3r-roadmap` (Codex: `$hatch3r-command-roadmap`).

## 2. Set up the board

:::note Board workflows are team-scoped
Steps 2-5 (board init / fill / pickup) install only when your repo resolved to **team** size. `hatch3r init` infers team size from git history (more than one distinct commit-author email ⇒ team) and defaults a single-author or fresh repo to **solo**, where the board cluster is not installed and `init` prints a one-line note saying so. Re-run with `--team-size team` (or switch later via `hatch3r config`) to add the board chain. Solo developers can drive single features without a board via `/hatch3r-feature-plan` (Codex: `$hatch3r-command-feature-plan`).
:::

Invoke the `hatch3r-board-init` skill from your editor (Claude Code: `Skill: hatch3r-board-init`; Cursor: load it from the skills picker; Copilot: reference it in chat; Codex: `$hatch3r-board-init`) to create or connect a project board on your detected platform.

Board-init handles:
- Project creation via GraphQL (GitHub Projects V2), or the Azure DevOps / GitLab equivalent
- Status field configuration (Backlog, Ready, In Progress, In Review, Done)
- Full label taxonomy creation
- Writing the resolved board owner / project number / area labels back to `hatch.json`

## 3. Define work

Create a `todo.md` file at the project root with your planned work -- epics, features, bugs, refactors, migrations, anything. One item per line.

```markdown
- Add OIDC login support for the customer portal
- Migrate analytics events to the new schema
- Replace Stripe webhook polling with idempotent event ingestion
```

## 4. Fill the board

Run `/hatch3r-board-fill` (Codex: `$hatch3r-command-board-fill`) to parse `todo.md` and turn items into platform issues.

Board-fill:
- Deduplicates against existing issues
- Classifies each item by type (feature / bug / refactor / migration / test), priority, executor, area, and risk
- Groups items into epics
- Builds a dependency DAG and determines implementation order
- Marks issues as `status:ready` when all readiness criteria are met

For backlog hygiene later, invoke the `hatch3r-board-groom` skill — it surfaces stale items, priority imbalances, and decomposition candidates.

## 5. Pick up work

Run `/hatch3r-board-pickup` (Codex: `$hatch3r-command-board-pickup`) to auto-select the next `status:ready` issue by dependency order and priority.

Board-pickup:
- Performs collision detection against in-progress work and open PRs
- Creates a feature branch
- Runs the four-phase agent pipeline: research → plan gate (a Tier >= 2 pickup persists a plan to `docs/plans/` and asks execute / revise / stop before implementing; auto-advance persists and continues) → implement → review loop (reviewer + fixer, max 3 iterations) → final quality gates (test-writer + security-auditor)
- Opens a pull request with full board status sync when the loop converges clean

Repeat this step until the board drains. The reviewer + fixer loop is automatic — there is no separate `review` command.

## 6. Review cycle

The reviewer, test-writer, and security-auditor agents review the work inside the pickup pipeline. When you need to address feedback by hand, push fixes and re-request review. For a standalone feature (no board), `/hatch3r-feature-plan` (Codex: `$hatch3r-command-feature-plan`) now ends with an execute-now choice (default) that walks the implement → review → test pipeline in the same session against the just-written plan; choose defer and the copy-paste `/hatch3r-workflow --plan-file=<path>` prompt (Codex: `$hatch3r-command-workflow --plan-file=<path>`) runs it in a fresh session instead.

## 7. Release

Invoke the `hatch3r-release` skill (Codex: `$hatch3r-release`), or run the `/hatch3r-release` orchestrator command (Codex: `$hatch3r-command-release`) for delegated execution with the review-loop and final-quality gate.

`/hatch3r-release` (Codex: `$hatch3r-command-release`) is a **cut-and-verify** workflow that **stops before publish** — it never publishes, merges, tags-and-pushes, or deploys on a bare invocation. It:
- Classifies merged PRs to determine the semantic version bump (patch / minor / major)
- Generates a grouped changelog (Added / Changed / Deprecated / Removed / Fixed / Security)
- Runs quality gates and emits supply-chain artifacts (CycloneDX SBOM, npm provenance, SLSA, cosign)
- Creates the annotated tag locally (reversible), then **stops and hands the publish decision to you**

The irreversible steps — tag push, `npm publish`, GitHub release create, production deploy — are default-OFF behind a `--publish` flag or a typed confirmation. Before invoking, run `npx hatch3r validate` to confirm canonical content has not drifted.

That closes the loop: init → spec → board → pickup → release.

## Where to read next

- [Quick Start](../getting-started/quick-start) — the copy-paste-runnable end-to-end walkthrough
- [MCP Setup](../guides/mcp-setup) — per-server configuration, PAT scope tables, custom MCP servers
- [Adapter Capability Matrix](../reference/adapter-capability-matrix) — which adapters emit MCP, hooks, skills, etc.
- [Troubleshooting](../troubleshooting) — common init / sync / MCP errors and fixes
