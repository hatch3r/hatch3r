# Migration — `/hatch3r-revision` → `/hatch3r-rework` (2026-07)

Release 2.6.0 renames the `hatch3r-revision` command to `hatch3r-rework` and redesigns it from fix-inline to plan-not-execute.

> **Addendum (2026-07-16, 2.7.1):** `/hatch3r-rework` now ends with an execute-now (same session, default) or defer choice after the plan is written — the copy-paste fresh-session prompt below remains as the deferral path. `--auto` and `--review-only` behavior is unchanged; neither auto-executes.

## What changed

- **Name:** `/hatch3r-revision` is now `/hatch3r-rework`. The companion directory `commands/revision/` is now `commands/rework/` (emitted as `.claude/commands/rework/`, `.cursor/commands/rework/`, `.github/prompts/rework/`).
- **Behavior:** the command no longer fixes inline, commits, or pushes. It still reconstructs the delivered work from the git diff, interviews you for feedback, and scans for agent leftovers — but it now validates the findings read-only (one `hatch3r-reviewer` pass, plus conditional `hatch3r-researcher` enrichment) and **ends at a rework plan** written to `docs/rework/{YYYY-MM-DD}-{branch-slug}.md`, followed by a copy-paste execution prompt for a fresh session: `/hatch3r-workflow --plan-file=docs/rework/...`.
- **`--review-only`:** unchanged — still the zero-write, report-in-chat code-review surface.
- **`--auto`:** now produces an unattended plan (interview skipped, routing auto-accepted, plan written without the confirm ASK). It never commits; the old auto-commit behavior is gone.
- **Distribution:** the `ctx:team-only` tag was dropped — the flow works from the git diff alone (a PR is optional), so solo installs now receive the command.

## What you need to do

1. Run `npx hatch3r sync` after upgrading. Regenerated setups drop the old `.{tool}/commands/hatch3r-revision.*` outputs automatically (orphan cleanup) and emit the `rework` set.
2. Type `/hatch3r-rework` where you previously typed `/hatch3r-revision`.
3. Execute the produced plan in a fresh session via `/hatch3r-workflow --plan-file=<path>` (or `/hatch3r-quick-change` for a cleanup-only plan of ≤3 single-line findings). The execution session commits the plan document together with the fixes.
