---
sidebar_position: 1
title: Workflow
---

# Workflow

hatch3r provides a full project lifecycle, from setup to release. This guide walks through the typical flow and links to the deeper view of the four-phase pickup pipeline and review loop.

:::info Last verified
2026-06-06 against hatch3r 2.0.0. The init flow described in Step 1 mirrors the canonical prompt order in `src/cli/commands/init.ts`; the copy-paste-runnable version lives in the [Quick Start](../getting-started/quick-start). Re-verified each audit cycle (P3 — Adapter & MCP Currency).
:::

## 1. Initialize

```bash
npx hatch3r init
```

Interactive setup (~2 minutes) detects your repository from its git remote and walks a short prompt sequence. On a fresh GitHub greenfield repo it asks 6 prompts:

1. **Platform** — GitHub, Azure DevOps, or GitLab, auto-detected from your git remote (press Enter to accept).
2. **Repo identity** — owner + repo (GitHub), namespace + project (GitLab), or org + project + repo (Azure DevOps), auto-filled from the remote where possible.
3. **Content profile** — `minimal`, `standard` (recommended), `full`, or `custom`.
4. **Custom content items** — only when `custom` is selected at step 3.
5. **Tools** — multi-select from the 3 supported adapters (Claude Code, Cursor, Copilot).
6. **MCP servers** — multi-select from 10 servers (3 default, 7 opt-in). Leaving everything unchecked skips MCP entirely; selecting any server auto-includes the platform MCP that matches your detected platform.

Default branch, project type (greenfield/brownfield), and team size (solo/team) are **inferred, not prompted** — branch from git, the others from repository signals. CLI-tool selection is **auto-inferred from project triggers** (no separate picker prompt); if detected tools are missing from PATH, hatch3r prints copy-paste install commands and adds one `Mark these tools as 'install pending' and continue?` confirm. Headless `--yes` skips every prompt.

:::tip CLI tools default-on since 1.7.5
hatch3r's primary agent-tooling surface is CLI tools (ripgrep, fd, jq, yq, gh, delta, bat, sd, ast-grep, zstd as the tier-1 default; 19 more across tier-2 conditional and tier-3 opt-in). MCP is opt-in. See [CLI Tools](../getting-started/cli-tools) for the full catalog, decision tree, and trade-off discussion.
:::

**Next steps after init:**

| Starting point | Command | What it does |
|----------------|---------|-------------|
| Full project (either kind) | `/hatch3r-spec` | Auto-detects greenfield vs brownfield and runs the matching spec flow |
| Single feature | `/hatch3r-feature-plan` | Plan one feature with parallel researchers — no board needed |
| Tiny change | `/hatch3r-quick-change` | One-shot flow for a typo, config tweak, or one-file refactor |

### Full project (greenfield or brownfield)

1. Run `/hatch3r-spec` -- on a new project it generates specs from your vision; on an existing codebase it reverse-engineers specs from the current code. It picks the branch by detecting project state, so you do not choose greenfield vs brownfield yourself. Produces `docs/specs/`, `docs/adr/`, and `todo.md`.
2. Run `/hatch3r-roadmap` to refine the plan into dependency-ordered epics broken into milestones.
3. Continue with board fill (step 4 below).

To force one branch, the split commands remain as a legacy path: `/hatch3r-project-spec` (greenfield only) or `/hatch3r-codebase-map` (brownfield only), each followed by `/hatch3r-roadmap`.

## 2. Set up the board

:::note Board workflows are team-scoped
Steps 2-5 (board init / fill / pickup) install only when your repo resolved to **team** size. `hatch3r init` infers team size from git history (more than one distinct commit-author email ⇒ team) and defaults a single-author or fresh repo to **solo**, where the board cluster is not installed and `init` prints a one-line note saying so. Re-run with `--team-size team` (or switch later via `hatch3r config`) to add the board chain. Solo developers can drive single features without a board via `/hatch3r-feature-plan`.
:::

Invoke the `hatch3r-board-init` skill from your editor (Claude Code: `Skill: hatch3r-board-init`; Cursor: load it from the skills picker; Copilot: reference it in chat) to create or connect a project board on your detected platform.

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

Run `/hatch3r-board-fill` to parse `todo.md` and turn items into platform issues.

Board-fill:
- Deduplicates against existing issues
- Classifies each item by type (feature / bug / refactor / migration / test), priority, executor, area, and risk
- Groups items into epics
- Builds a dependency DAG and determines implementation order
- Marks issues as `status:ready` when all readiness criteria are met

For backlog hygiene later, invoke the `hatch3r-board-groom` skill — it surfaces stale items, priority imbalances, and decomposition candidates.

## 5. Pick up work

Run `/hatch3r-board-pickup` to auto-select the next `status:ready` issue by dependency order and priority.

Board-pickup:
- Performs collision detection against in-progress work and open PRs
- Creates a feature branch
- Runs the four-phase agent pipeline: research → implement → review loop (reviewer + fixer, max 3 iterations) → final quality gates (test-writer + security-auditor)
- Opens a pull request with full board status sync when the loop converges clean

Repeat this step until the board drains. The reviewer + fixer loop is automatic — there is no separate `review` command.

## 6. Review cycle

The reviewer, test-writer, and security-auditor agents review the work inside the pickup pipeline. When you need to address feedback by hand, push fixes and re-request review. For a standalone feature (no board), run `/hatch3r-workflow` (Quick Mode) after `/hatch3r-feature-plan` to walk the implement → review → test pipeline directly.

## 7. Release

Invoke the `hatch3r-release` skill, or run the `/hatch3r-release` orchestrator command for delegated execution with the review-loop and final-quality gate.

`/hatch3r-release` is a **cut-and-verify** workflow that **stops before publish** — it never publishes, merges, tags-and-pushes, or deploys on a bare invocation. It:
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
