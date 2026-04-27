---
id: hatch3r-create
type: command
orchestrator: true
agentPipeline: [hatch3r-creator]
description: Author a custom user-tier artifact (agent, skill, rule, command, or hook) for this project. Generates frontmatter and body skeleton, applies strict + gentle quality gates, writes to .agents/user/{type}/, and offers to sync to all enabled adapters.
tags: [core, customize]
quality_charter: agents/shared/quality-charter.md
---

## Agent Pipeline

This command runs as an orchestrator. After collecting inputs in Phase 1, it delegates artifact composition and the strict + gentle gate funnel to `hatch3r-creator` via the Task tool. Phase 3 runs `hatch3r validate` and surfaces results inline.

# `/hatch3r-create` — Author a User-Tier Artifact

Use this command when you need a project-specific agent, skill, rule, command, or hook that does not exist in the canonical hatch3r corpus. The command writes one new artifact under `.agents/user/{type}/` per invocation, runs the same frontmatter/security/structural gates the framework uses on canonical content (strict — block on failure), and runs style/lean checks as warnings (gentle — save proceeds, warnings reported).

The 5 supported types: **agent** (sub-agent invokable from orchestrators), **skill** (workflow recipe), **rule** (always or glob-scoped guidance), **command** (slash command, inline or orchestrator), **hook** (event-triggered agent invocation).

---

## Workflow

The command runs in three phases. Phase 1 collects every input upfront. Phase 2 delegates to `hatch3r-creator`. Phase 3 verifies and reports. No file is written until the user confirms the plan in Step 1.7.

---

### Phase 1 — Collect & Plan

#### 1.1: Choose Artifact Type

Present the 5 types with one-sentence descriptions and ask the user to select one.

```
Which type of artifact?
  1) agent    — A sub-agent invoked by orchestrators via the Task tool
  2) skill    — A reusable workflow recipe followed by an agent
  3) rule     — Coding/process guidance applied always or by glob match
  4) command  — A slash-command entry point (inline or orchestrator)
  5) hook     — An event-triggered agent invocation (pre-commit, file-save, etc.)
```

**ASK:** "Select artifact type (1-5)."

Cache the selection as `type`.

#### 1.2: Choose Name

**ASK:** "Provide a kebab-case name for the artifact (lowercase, hyphens only, no spaces). Example: `pr-summarizer`."

Validate the name against the regex `^[a-z][a-z0-9-]*$`. Reject and re-ask if:

- The name fails the regex (uppercase, underscores, leading digit, etc.).
- The name starts with `hatch3r-` — this prefix is reserved for canonical framework content. Show: "Names starting with `hatch3r-` are reserved for canonical framework artifacts. Choose a different prefix or omit the prefix entirely. The framework will namespace the file path under `.agents/user/{type}/` automatically."

Cache the validated name as `name`.

#### 1.3: Description

**ASK:** "Provide a one-paragraph description (minimum 60 characters). This appears in the AI tool's artifact picker — make it specific enough that the right artifact is selected when the user asks."

Reject and re-ask if the description is shorter than 60 characters. Cache as `description`.

#### 1.4: Tags

Present the known tag set: `core, customization, planning, implementation, review, performance, a11y, security, board`.

**ASK:** "Select one or more tags (comma-separated). You may add custom project tags after the known set, e.g., `implementation, my-team`."

Cache as `tags` (array).

#### 1.5: Adapter Scope (Optional)

**ASK:** "Restrict this artifact to specific adapters? Press Enter to default to ALL enabled adapters (full parity), or list adapter names like `claude, cursor`."

Cache as `adapters` (array, or `null` for full parity).

#### 1.6: Type-Specific Prompts

Branch on the cached `type`:

- **agent:** Ask for `model` preference (default: `standard`; options: `fast | standard | reasoning`). Ask for an optional tool-allowlist hint (free-text). Cache as `model` and `toolHint`.
- **skill:** Confirm the subdirectory layout. Show: "Skill files are stored as `.agents/user/skills/{name}/SKILL.md` (a new directory will be created). Continue?" — ASK Y/n.
- **rule:** Ask for scope: `always` (loaded every session) or `conditional` (loaded by glob match). If `conditional`, ASK for a comma-separated glob list (e.g., `src/**/*.ts, src/**/*.tsx`). Then ASK for `precedence` (one of `critical | high | normal | low`, default `normal`). Cache as `ruleScope`, `ruleGlobs`, `rulePrecedence`.
- **command:** ASK whether this is an orchestrator command. If yes, ASK for the agent pipeline as a comma-separated list of agent IDs (each ID must reference an existing agent — canonical or under `.agents/user/agents/`). Cache as `isOrchestrator` and `agentPipeline`.
- **hook:** ASK for the hook event from the enum: `pre-commit | post-merge | ci-failure | file-save | session-start | pre-push`. Reject any value outside this enum and re-ask. Cache as `hookEvent`.

#### 1.7: Plan Summary & Confirmation

Render the proposed file path, full frontmatter block, and body-skeleton outline. For an agent plan, the summary lists `Path`, `Type`, `Name`, `Description` (first 80 chars), `Tags`, `Adapters` (or "all enabled"), `Model`; then the frontmatter block; then the body-skeleton outline (`<task>`, `<context>`, Implementation Protocol numbered steps, `<rules>`). For other types, swap the type-specific slots from Step 1.6.

**ASK:** "Confirm to delegate authoring to `hatch3r-creator`, or specify changes (e.g., 'change model to fast', 'add tag: review')."

Loop until the user confirms.

---

### Phase 2 — Delegate to `hatch3r-creator`

Use the Task tool to invoke the `hatch3r-creator` sub-agent. If `hatch3r-creator` is not registered in the current session, fall back to `general-purpose` and pass the same input contract — the agent file is part of this release and lives at `agents/hatch3r-creator.md`.

Pass the collected slots as a structured input:

```
{
  type:          "{type}",
  name:          "{name}",
  description:   "{description}",
  tags:          [{tags}],
  adapters:      [{adapters}] | null,
  model:         "{model}",        // agent only
  toolHint:      "{toolHint}",     // agent only (optional)
  ruleScope:     "{ruleScope}",    // rule only
  ruleGlobs:     [{ruleGlobs}],    // rule only (when scope=conditional)
  rulePrecedence:"{rulePrecedence}", // rule only
  isOrchestrator: {bool},          // command only
  agentPipeline: [{agentPipeline}],// command only (when isOrchestrator=true)
  hookEvent:     "{hookEvent}"     // hook only
}
```

The sub-agent composes frontmatter + body, calls `saveUserContent` from `src/content/userContent.ts` (the canonical strict + gentle gate funnel), and atomic-writes the file via `src/merge/safeWrite.ts`. For rule artifacts, `saveUserContent` also generates the paired `.mdc` companion using the `.md → .mdc` scope transform documented in `rules/hatch3r-content-authoring.md`. For skill artifacts, it creates the `{name}/` subdirectory and writes `SKILL.md` inside.

Wait for the sub-agent's structured return:

```
{
  status:       "WRITTEN" | "STRICT_GATE_FAILED" | "BLOCKED",
  paths:        ["{absolute path}"],
  strictErrors: [{message, gate, line?}],
  gentleWarnings: [{message, gate, line?}]
}
```

If `status: "STRICT_GATE_FAILED"`, surface every entry in `strictErrors` to the user verbatim and offer to retry Phase 1 with corrections. Do not proceed to Phase 3.

If `status: "BLOCKED"`, surface the blocker (e.g., user file collision) and stop.

---

### Phase 3 — Post-Create Housekeeping

Only run this phase when Phase 2 returns `status: "WRITTEN"`.

#### 3.1: Validate

Run `hatch3r validate --verbose` and capture stdout + exit code. Surface every error and warning related to the new artifact verbatim, plus a summary line: "Validate completed with N errors, M warnings (X relate to the new artifact)." If validate reports errors that block the artifact, instruct the user to edit the file directly at the printed absolute path or re-run `/hatch3r-create` after deleting the file.

#### 3.2: Print Path & Sync Offer

Print the absolute path(s) and the next-step pointer:

```
Created:
  /abs/path/.agents/user/{type}/{name}.md
  /abs/path/.agents/user/rules/{name}.mdc   (rule only — paired companion)

Next step:
  Run `hatch3r sync` to propagate this artifact to all enabled adapter outputs
  (.cursor/, .claude/, .github/copilot-instructions.md, etc.).

Edit your artifact directly anytime — `.agents/user/` is preserved across
`hatch3r update` and `hatch3r clean`.
```

---

## Constraints / Anti-Patterns

- **Never overwrite an existing user file.** Collision with an existing path under `.agents/user/{type}/` is a strict-gate failure raised by `hatch3r-creator` (status `BLOCKED` with the conflicting path).
- **Never write to canonical content directories.** All output goes under `.agents/user/`. Writes to `agents/`, `skills/`, `rules/`, `commands/`, or `hooks/` are rejected.
- **Never bypass strict gates.** Strict failures (frontmatter, ID collision, deny patterns, paired-file parity, orchestrator contract, hook event enum, ≤10KB size) block the save.
- **Pillar coverage required.** Every user artifact must declare at least one of P1–P6 in tags or body. Authors that do not select a pillar-aligned tag are warned by the gentle gate; the artifact still saves but the warning surfaces in Phase 3.
- **One artifact per invocation.** Re-run `/hatch3r-create` for additional artifacts.

---

## Quality Charter

This command and the `hatch3r-creator` sub-agent both inherit the standards in `agents/shared/quality-charter.md` — confidence levels, root-cause orientation, measurable acceptance criteria, and graceful failure with corrective messages.
