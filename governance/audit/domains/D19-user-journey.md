# Domain 19: User Journey & Adoption Friction

**Scope:** The gap between "code works correctly" and "user succeeds" — tracing actual user journeys through the codebase to find where correct code creates confusion, surprise, or failure. Existing domains audit technical correctness; this domain audits whether users understand what's happening and what to do next.
**Sub-agents:** 5

**Evaluation method:** Each sub-agent traces a concrete user scenario end-to-end through the codebase. Reference specific files, functions, output strings, and user-facing messages. Findings are about UX clarity and adoption friction, not code correctness (other domains cover that).

| SA | Focus |
|----|-------|
| 19.1 | Post-Init to First Value |
| 19.2 | Customization Clarity |
| 19.3 | Multi-Tool Coexistence |
| 19.4 | Content Profile & Selection Impact |
| 19.5 | Workflow Chain Viability |

## Audit Checklists

### 19.1 Post-Init to First Value
Audit the critical 30 minutes after `hatch3r init` completes.
- [ ] Post-init message clarity — does it distinguish CLI commands (`hatch3r sync`) from agent tool slash commands (`/project-spec`, `/workflow`)?
- [ ] MCP setup guidance — is the `.env.mcp` → source → verify flow explained at the right moment, or does the user only discover it when a command fails?
- [ ] First agent invocation path — can a user go from init completion to a successful `/project-spec` or `/codebase-map` without consulting external documentation?
- [ ] Error messages for common missteps — running `/project-spec` in the terminal (not in agent tool), missing env vars, wrong editor launched without sourcing `.env.mcp`
- [ ] Time-to-first-value — how many steps (decisions, file edits, tool launches) between init and first useful agent output?
- [ ] Greenfield vs brownfield guidance — does post-init messaging adapt based on the project type selected during init?
- [ ] Simulated end-to-end walkthrough — trace the actual init --> first-value path on two representative sample repos (one greenfield, one brownfield). Execute each step mentally as a new user would: read the post-init message, decide what to do next, invoke the first command, interpret the output. Record every friction point, unclear message, missing prerequisite, and moment of confusion. This is not a code review — it is a user experience trace.

**Key files:** `src/cli/commands/init.ts` (post-init messaging), `website/docs/getting-started/quick-start.md`, generated `CLAUDE.md`/`.cursor/rules/` (do they explain available commands?)

**Web research:** First-run experience best practices for CLI tools, time-to-first-value benchmarks for developer tools, onboarding drop-off research.

### 19.2 Customization Clarity
Audit whether users can customize without breaking things or getting confused.
- [ ] Are the three customization mechanisms (managed blocks, `.customize.yaml`, manual edits outside blocks) distinguished anywhere the user encounters them?
- [ ] Does `hatch3r sync` or `hatch3r update` output explain what was preserved vs overwritten, or does it only show file counts?
- [ ] Are `.customize.yaml` files validated for syntax (valid YAML) and references (valid agent/skill IDs)?
- [ ] Is there a recovery path when a user accidentally deletes managed block markers (`HATCH3R:BEGIN`/`HATCH3R:END`)?
- [ ] Does `hatch3r config` output clarify its relationship to `.customize.yaml`? (Config changes global settings; customize overrides per-item properties)
- [ ] Does removing a content item (agent/skill via `hatch3r config`) warn about dependent items that will break?
- [ ] Is the "sync fear factor" addressed — does any messaging reassure users that customizations outside managed blocks are preserved?

**Key files:** `src/manifest/hatchJson.ts`, `src/cli/commands/config.ts`, `src/cli/commands/sync.ts` (output messaging), `src/adapters/base.ts` (managed block merge)

**Web research:** Managed content merge patterns in developer tools, customization UX in framework scaffolding tools (create-react-app, Angular CLI, Nx).

### 19.3 Multi-Tool Coexistence
Audit friction when multiple coding tools are enabled on the same repo.
- [ ] Shared config path conflicts — do any adapters write to the same output file? (e.g., `.vscode/mcp.json` shared by Cursor and Copilot, `.vscode/settings.json`)
- [ ] Per-editor secret loading differences — are these documented at tool selection time during init, or discovered later?
- [ ] Adapter cleanup on removal — when removing a tool via `hatch3r config`, are its generated files deleted?
- [ ] Output path collision audit — enumerate all adapter output paths and identify overlaps
- [ ] Tool switching guidance — is there documented guidance for migrating from one tool to another (e.g., Cursor → Claude Code)?

**Key files:** All adapter files in `src/adapters/`, `src/cli/commands/config.ts` (tool add/remove flow)

**Web research:** Multi-editor configuration management patterns, VS Code extension coexistence issues, developer tool configuration collision research.

### 19.4 Content Profile & Selection Impact
Audit the cascading effects of choices made during init that users don't fully see at decision time.
- [ ] Does the content profile selector (Minimal/Standard/Full) show what's excluded, not just what's included?
- [ ] Are greenfield/brownfield and solo/team filter effects visible at selection time, or applied silently?
- [ ] Content dependency chains — does removing agent X break skills Y and Z? Is this dependency surfaced to the user?
- [ ] Wrong profile recovery — can a user change from Minimal to Standard after init? How? Is the path obvious? (`hatch3r config` → content profile)
- [ ] Preset upgrade path — is going from Standard → Full additive (adds missing items) or destructive (re-init)?
- [ ] Filter interaction effects — what does a brownfield + solo + Minimal user actually get? Is this the intended experience?

**Key files:** `src/content/index.ts` (content resolution logic), `src/content/presets.ts` (profile definitions), `src/content/tags.ts` (filter/tag logic), `src/cli/commands/init.ts` (selection prompts and messaging)

**Web research:** Content selection UX in developer tool scaffolding, progressive disclosure patterns, preset/template selection in CLI tools (Vite, create-next-app, Yeoman).

### 19.5 Workflow Chain Viability
Audit whether the prescribed workflow chain actually works end-to-end for a real user.
- [ ] Map the full prescribed chain: `init` → `/project-spec` or `/codebase-map` → `/roadmap` → `/board-init` → `todo.md` → `/board-fill` → `/board-pickup` → `/workflow` → `/review` → `/release`
- [ ] For each step: what external prerequisites are required? (GitHub Projects V2, specific MCP servers, API keys, git remote, branch setup)
- [ ] Which steps fail silently without prerequisites vs. fail with clear errors?
- [ ] Which steps are truly optional vs. presented as optional but practically required for the next step?
- [ ] Is there a documented "lite path" for users who don't want board management? Does the workflow chain still make sense without board steps?
- [ ] Progressive disclosure — do users encounter features at the right time in their journey, or are all 34 commands and 25 skills visible from day one?
- [ ] Does the quick-start documentation accurately represent the minimum viable workflow?

**Key files:** Content artifacts in `.agents/commands/`, `.agents/skills/`, `website/docs/guides/`, `website/docs/getting-started/quick-start.md`

**Web research:** Developer tool workflow design, progressive complexity in CLI tools, feature discoverability research for developer tools.
