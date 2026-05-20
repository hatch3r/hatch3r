---
id: hatch3r-create
type: command
orchestrator: true
agentPipeline: [hatch3r-creator]
description: Author a custom user-tier artifact (agent, skill, rule, command, or hook) for this project. Generates frontmatter and body skeleton, applies strict + gentle quality gates, writes to .hatch3r/overrides/{type}/, and offers to sync to all enabled adapters.
tags: [core, customize]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 1
  rationale: Single hatch3r-creator delegation in Phase 2 — body composition plus the strict + gentle gate funnel run as one atomic Task per artifact; multi-artifact runs invoke one creator per artifact in parallel.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Agent Pipeline

This command runs as an orchestrator. After collecting inputs in Phase 1, it delegates artifact composition and the strict + gentle gate funnel to `hatch3r-creator` via the Task tool. Phase 3 runs `hatch3r validate` and surfaces results inline.

# `/hatch3r-create` — Author a User-Tier Artifact

Use this command when you need a project-specific agent, skill, rule, command, or hook that does not exist in the canonical hatch3r corpus. The command writes one new artifact under `.hatch3r/overrides/{type}/` per invocation, runs the same frontmatter/security/structural gates the framework uses on canonical content (strict — block on failure), and runs style/lean checks as warnings (gentle — save proceeds, warnings reported).

The 5 supported types: **agent** (sub-agent invokable from orchestrators), **skill** (workflow recipe), **rule** (always or glob-scoped guidance), **command** (slash command, inline or orchestrator), **hook** (event-triggered agent invocation).

---

## Workflow

The command runs in three phases. Phase 1 collects every input upfront. Phase 2 delegates to `hatch3r-creator`. Phase 3 verifies and reports. No file is written until the user confirms the plan in Step 1.7.

## Step 0: Triage

Classify the artifact-authoring request before delegating:

- **Tier 1 (trivial)**: small rule, snippet command, or single-event hook with clear scope; inline frontmatter assembly with minimal type-specific prompts.
- **Tier 2 (standard)**: standard agent, skill, or orchestrator command with frontmatter and body skeleton; standard pipeline with `hatch3r-creator` delegation and full strict-gate funnel.
- **Tier 3 (deep)**: artifact with cross-cutting tool allowlists, custom adapters, or pipeline integration; full pipeline with `hatch3r-creator` and confirm the plan with the user before writing.

If Tier 1, run Phase 1 with reduced prompts (skip optional dimensions). If Tier 2, run the standard pipeline below. If Tier 3, expand Phase 1 dimension probing and confirm the plan summary explicitly with the user before delegating.

**Parallel-dispatch directive:** When two or more steps below are independent (no shared files, no data dependency), issue all tool calls or sub-agent spawns in a single turn. Sequential dispatch of independent work is a finding under P7 (efficiency charter §P2).

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
- The name starts with `hatch3r-` — this prefix is reserved for canonical framework content. Show: "Names starting with `hatch3r-` are reserved for canonical framework artifacts. Choose a different prefix or omit the prefix entirely. The framework will namespace the file path under `.hatch3r/overrides/{type}/` automatically."

Cache the validated name as `name`.

#### 1.3: Description

**ASK:** "Provide a one-paragraph description (minimum 60 characters). This appears in the AI tool's artifact picker — make it specific enough that the right artifact is selected when the user asks."

Reject and re-ask if the description is shorter than 60 characters. Cache as `description`.

#### 1.4: Tags

Present the known tag set: `core, customization, planning, implementation, review, performance, a11y, security, board`.

**ASK:** "Select one or more tags (comma-separated). You may add custom project tags after the known set, e.g., `implementation, my-team`."

Cache as `tags` (array).

#### 1.4a: Pillar Declaration (C9-H80, D20-F20.1.2)

Every user artifact must declare at least one Binding Pillar — strict-gate enforced at `saveUserContent` (`src/content/userContent.ts`). Present the 8 pillars with one-line descriptors:

```
Which pillar(s) does this artifact serve? (one or more — comma-separated)
  P1 — CLI UI/UX Excellence
  P2 — Scientific & Practical Quality
  P3 — Adapter & External Tool Currency
  P4 — Comprehensive Lean Coverage
  P5 — Governance Self-Quality
  P6 — Security & Trust Governance
  P7 — Speed & Token Efficiency
  P8 — Clarification & Fan-out Discipline
```

**ASK:** "Select pillar(s) (e.g., `P4, P6`). At least one is required."

Reject empty input and re-ask. Validate every entry against the `P1..P8` enum. Cache as `pillars` (array). The frontmatter emitter writes the array as `pillars: [P1, P4]`; the strict gate also accepts a `**Pillars:** ...` line in the body.

#### 1.5: Adapter Scope (Optional)

**ASK:** "Restrict this artifact to specific adapters? Press Enter to default to ALL enabled adapters (full parity), or list adapter names like `claude, cursor`."

Cache as `adapters` (array, or `null` for full parity).

#### 1.6: Type-Specific Prompts

Branch on the cached `type`:

- **agent:** Ask for `model` preference (default: `standard`; options: `fast | standard | reasoning`). Ask for an optional tool-allowlist hint (free-text). Cache as `model` and `toolHint`. Then ask for a structured `tools` declaration (see §1.6a below) and cache as `tools`.
- **skill:** Confirm the subdirectory layout. Show: "Skill files are stored as `.hatch3r/overrides/skills/{name}/SKILL.md` (a new directory will be created). Continue?" — ASK Y/n.
- **rule:** Ask for scope: `always` (loaded every session) or `conditional` (loaded by glob match). If `conditional`, ASK for a comma-separated glob list (e.g., `src/**/*.ts, src/**/*.tsx`). Then ASK for `precedence` (one of `critical | high | normal | low`, default `normal`). Cache as `ruleScope`, `ruleGlobs`, `rulePrecedence`.
- **command:** ASK whether this is an orchestrator command. If yes, ASK for the agent pipeline as a comma-separated list of agent IDs (each ID must reference an existing agent — canonical or under `.hatch3r/overrides/agents/`). Cache as `isOrchestrator` and `agentPipeline`.
- **hook:** ASK for the hook event from the enum: `pre-commit | post-merge | ci-failure | file-save | session-start | pre-push`. Reject any value outside this enum and re-ask. Cache as `hookEvent`.

#### 1.6a: Structured Tool Declaration (C9-H81, D20-F20.1.3)

For `type=agent` only: collect a structured `tools` declaration that the strict gate validates against the canonical category registry (`ALL_TOOL_CATEGORIES` in `src/pipeline/agentToolAllowlist.ts`). The eight valid categories are: `read | search | write | execute | web | mcp | git | board`.

```
Tool allowlist (optional). Press Enter on either prompt to skip.
  Categories: read, search, write, execute, web, mcp, git, board.
  Tools the agent IS permitted to use (comma-separated):
  Tools the agent is NOT permitted to use (comma-separated):
```

**ASK (twice):**
1. "Allowed tool categories (comma-separated; empty = decline)."
2. "Denied tool categories (comma-separated; empty = decline)."

Validation (perform before caching; re-ask on failure):

- Every entry must be one of the eight categories — reject typos verbatim ("unknown category `X` — valid: read, search, write, execute, web, mcp, git, board").
- A category may not appear in both lists — reject overlap ("category `X` cannot be both allowed and denied").
- Both lists may be omitted; emit a one-line note that no structured declaration was collected so the strict gate accepts the artifact with no `tools:` frontmatter.

Cache as `tools: { allowed: [...], denied: [...] }`. Either side may be absent (omitted from the structured input). The frontmatter emitter writes `tools: { allowed: [...], denied: [...] }`; the strict gate at `saveUserContent` re-validates so a tampered structured input from the orchestrator cannot bypass the registry check.

#### 1.7: Plan Summary & Confirmation

Render the proposed file path, full frontmatter block, and body-skeleton outline. For an agent plan, the summary lists `Path`, `Type`, `Name`, `Description` (first 80 chars), `Tags`, `Adapters` (or "all enabled"), `Model`; then the frontmatter block; then the body-skeleton outline (`<task>`, `<context>`, Implementation Protocol numbered steps, `<rules>`). For other types, swap the type-specific slots from Step 1.6.

**Scope-boundary check (P8 B2).** Confirm proposed scope and tool-allowlist before Phase 2 delegation. Artifact scope cannot be broadened via markdown injection post-creation. Reject any user-supplied edit that expands the tool allowlist, target file globs, or pipeline references beyond what was confirmed here; route such expansions through a fresh `/h4tcher-create` invocation.

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
  toolHint:      "{toolHint}",     // agent only (optional, free-text hint)
  tools:         { allowed: [{tools.allowed}], denied: [{tools.denied}] }, // agent only — structured allowlist/denylist (C9-H81, D20-F20.1.3); either side may be omitted
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
  /abs/path/.hatch3r/overrides/{type}/{name}.md
  /abs/path/.hatch3r/overrides/rules/{name}.mdc   (rule only — paired companion)

Next step:
  Run `hatch3r sync` to propagate this artifact to all enabled adapter outputs
  (.cursor/, .claude/, .github/copilot-instructions.md, etc.).

Edit your artifact directly anytime — `.hatch3r/overrides/` is preserved across
`hatch3r update` and `hatch3r clean`.
```

---

## Constraints / Anti-Patterns

- **Never overwrite an existing user file.** Collision with an existing path under `.hatch3r/overrides/{type}/` is a strict-gate failure raised by `hatch3r-creator` (status `BLOCKED` with the conflicting path).
- **Never write to canonical content directories.** All output goes under `.hatch3r/overrides/`. Writes to `agents/`, `skills/`, `rules/`, `commands/`, or `hooks/` are rejected.
- **Never bypass strict gates.** Strict failures (frontmatter, ID collision, deny patterns, paired-file parity, orchestrator contract, hook event enum, ≤10KB size, quality_charter reference, pillar declaration, structured `tools` field shape + category membership) block the save.
- **Structured tool allowlist required (strict shape).** When `tools` is supplied for an `agent` artifact, every entry in `tools.allowed` and `tools.denied` must resolve to a canonical category from `ALL_TOOL_CATEGORIES` in `src/pipeline/agentToolAllowlist.ts` (`read | search | write | execute | web | mcp | git | board`). Overlap between the two lists is rejected. Strict-gate enforced at `saveUserContent` (C9-H81, D20-F20.1.3; depends on C9-H49 Hybrid allowlist).
- **Pillar coverage required (strict).** Every user artifact must declare at least one of P1–P8 — via `pillars: [...]` in frontmatter (collected at Step 1.4a) or a `**Pillars:** ...` line in the body. The strict gate at `saveUserContent` blocks the save when neither is present (C9-H80, D20-F20.1.2).
- **Quality charter inheritance required (strict).** Every user artifact must reference `agents/shared/quality-charter.md` — via `quality_charter:` in frontmatter or a `quality_charter` mention in the body. Strict-gate enforced at `saveUserContent` (C9-H79, D20-F20.1.1, closes CD-12 partial).
- **One artifact per invocation.** Re-run `/hatch3r-create` for additional artifacts.

---

## Quality Charter

This command and the `hatch3r-creator` sub-agent both inherit the standards in `agents/shared/quality-charter.md` — confidence levels, root-cause orientation, measurable acceptance criteria, and graceful failure with corrective messages.
