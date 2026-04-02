---
id: hatch3r-onboard
type: command
description: Generate a comprehensive onboarding guide for a new developer joining the project -- spawn parallel researchers to analyze codebase structure, architecture, and conventions, then produce a tailored onboarding document with setup instructions, architecture walkthrough, coding conventions, key workflows, tribal knowledge, and a quick-reference cheat sheet.
tags: [brownfield, team]
quality_charter: agents/shared/quality-charter.md
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Project Analysis | `hatch3r-researcher` (3 parallel: codebase-overview, architecture, conventions) | Yes | Yes |
| 2. Setup Verification | Orchestrator (inline) | No | Yes |
| 3. Guide Generation | `hatch3r-docs-writer` | No | Yes |

# Onboarding Guide Generator — Tailored Developer Onboarding from Codebase Analysis to Ready-to-Work Guide

Take a new developer's role, experience level, and focus areas and produce a comprehensive onboarding guide covering project setup, architecture, coding conventions, key workflows, tribal knowledge, and a quick-reference cheat sheet. Spawns parallel researcher sub-agents (codebase overview, architecture mapping, conventions extraction) to analyze the project from multiple angles before generating a tailored guide document. AI proposes all outputs; user confirms before any files are written. Adapts depth and focus to the developer's experience level and role.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run** if it exists. While this command does not perform board operations, it establishes patterns and context (GitHub owner/repo, tooling directives) that provide project metadata useful for the onboarding guide. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory — do not re-invoke sub-agents.
2. **Limit documentation reads.** When reading existing project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Gather Context

1. **ASK:** "Tell me about the developer who will use this onboarding guide. I need:
   - **Role:** `frontend`, `backend`, `fullstack`, `devops`, or `general` (default)
   - **Experience level:** `junior`, `mid`, `senior`, or `staff` (adjusts depth and assumed knowledge)
   - **Focus areas:** specific modules, features, or systems they'll work on first (or `all`)
   - **Output format:** `markdown` (default), `issue` (create GitHub issue with guide), or `notion` (Notion-formatted markdown)

   If you're onboarding yourself, just tell me your role and what you'll be working on."

2. Present a structured summary:

```
Onboarding Brief:
  Role:           {role}
  Experience:     {level}
  Focus areas:    {areas or "all"}
  Output format:  {format}
  Depth:          {derived — junior=detailed, mid=standard, senior=concise, staff=architecture-focused}
```

**ASK:** "Does this capture the onboarding needs correctly? Adjust anything before I continue."

#### Step 1b: Dimension Probing (Team Context)

After the onboarding brief is confirmed, probe for team-specific context that cannot be discovered from the codebase. Generate targeted follow-up questions from the most relevant dimensions:

1. Analyze the confirmed brief for missing information the codebase alone cannot provide.
2. Generate 3–7 targeted questions from relevant dimensions:
   - **Tooling:** What IDE, extensions, local tools, or services does the team use beyond the codebase?
   - **Access & credentials:** What systems need access grants? (CI, cloud, staging, monitoring, secrets vault)
   - **Communication:** Where does the team communicate? (Slack channels, standups, on-call rotation)
   - **Review process:** Who reviews PRs? Any CODEOWNERS? Required approvals? Review SLA?
   - **Deploy process:** Who can deploy? What's the release cadence? Feature flags?
   - **Mentorship:** Is there a buddy system? Who should the new developer ask for help?
   - **On-call & incidents:** Are new developers added to on-call? What's the incident process?
3. Skip dimensions the user already addressed in the brief.

**ASK:** "Before I analyze the project, I have {N} questions about team context that the codebase can't tell me:
{numbered question list — each with the dimension label and why the answer matters}

Answer these now, or say 'skip' for any where you'd rather I omit that section from the guide."

4. Record answers as **Team Context**. These are included in the guide and passed to the docs writer.
5. For skipped questions, omit the relevant section from the guide rather than inventing answers.

---

### Step 2: Load Project Context

1. Check for existing documentation:
   - `README.md` — existing setup instructions, project description
   - `CONTRIBUTING.md` — contribution guidelines
   - `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` — project metadata, scripts, dependencies
   - `.env.example` — environment variable template
   - `docs/` — any existing documentation
   - `.agents/rules/` — coding standards and conventions
   - `.agents/learnings/` — team learnings and institutional knowledge
   - CI config (`.github/workflows/`, `.gitlab-ci.yml`, etc.) — CI/CD pipeline
2. Scan the top-level directory structure to understand project organization.
3. If `.agents/learnings/` exists, scan for learnings relevant to onboarding, common mistakes, and gotchas. Match by area and tags.
4. Present a context summary:

```
Context Loaded:
  README:           {found / not found — brief summary if found}
  CONTRIBUTING:     {found / not found}
  Package manifest: {type — with N scripts, M dependencies}
  Env template:     {found / not found}
  Docs:             {N} files in docs/ ({key ones listed})
  Rules:            {N} files in .agents/rules/ ({areas covered})
  Learnings:        {N} relevant learnings
  CI:               {type — N workflows}
  Gaps:             {list any missing context — e.g., "no CONTRIBUTING.md", "no .env.example"}
```

---

### Step 3: Spawn Parallel Researcher Sub-Agents

Spawn one sub-agent per research domain below concurrently, each following the **hatch3r-researcher agent protocol**. Each receives the confirmed onboarding brief from Step 1 (including role and experience level) and the context summary from Step 2.

**Each sub-agent prompt must include:**
- The full confirmed onboarding brief (role, experience, focus areas)
- The Team Context from Step 1b
- The project context summary from Step 2
- Instruction to follow the **hatch3r-researcher agent protocol**
- The assigned mode (one per sub-agent) and depth level `standard`
- Instruction to tailor findings to the specified experience level

| Sub-Agent | Researcher Mode | Focus |
|-----------|----------------|-------|
| 1 | `codebase-overview` | Map directory structure, entry points, tech stack, key dependencies, package scripts, build/test/run commands |
| 2 | `architecture` | Identify architectural patterns, data flow, module boundaries, API surface, state management, key abstractions |
| 3 | `conventions` | Extract coding standards from rules files and codebase patterns — naming, file organization, commit conventions, PR process, testing strategy |

Each sub-agent produces the structured output defined by its mode in the hatch3r-researcher agent specification.

Wait for all sub-agents to complete before proceeding.

---

### Step 4: Synthesize & Review Research

1. Present a **merged summary** combining key findings from all researchers:

```
Project Analysis Summary:

Project:            {name}
Tech stack:         {languages, frameworks, runtimes}
Architecture:       {pattern — e.g., monolith, modular monolith, microservices}
Entry points:       {N} ({list — API server, CLI, web app, etc.})
Key modules:        {N} modules ({list top-level})
Scripts/commands:    {N} available ({key ones listed})
Conventions found:  {N} rules files, {M} patterns extracted
Test strategy:      {unit / integration / e2e — tools used}
CI/CD:              {pipeline type and key steps}
Documentation gaps: {list what's missing or outdated}
```

2. **Highlight areas that need human input** — things the researchers cannot discover from code:
   - Undocumented deploy procedures or access provisioning steps
   - Team norms not captured in rules files
   - Historical context on architectural decisions
   - Known issues or workarounds that live in team memory

**ASK:** "Here is what I found from analyzing the project. Before I generate the guide:
1. Is anything above incorrect or outdated?
2. Any undocumented context I should include? (deploy procedures, team norms, historical decisions)
3. Anything I should emphasize or de-emphasize for this developer's role?

Confirm, or provide additional context."

---

### Step 5: Generate Onboarding Guide

Spawn a `hatch3r-docs-writer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) to generate the onboarding guide from the merged research outputs. The docs writer receives the full research synthesis, team context, and the onboarding brief.

The guide is structured as a single markdown document following the **Onboarding Guide Template** (see Output Template below). The docs writer generates all sections, adapting depth to the developer's experience level:

| Experience Level | Depth Adjustments |
|-----------------|-------------------|
| Junior | Explain concepts, include "why" context, expand setup steps with expected output, add glossary of project-specific terms |
| Mid | Standard depth, focus on conventions and workflows, link to deeper docs where they exist |
| Senior | Concise setup, emphasize architecture and design decisions, highlight non-obvious patterns and trade-offs |
| Staff | Architecture-focused, include system-level context, integration boundaries, data flow diagrams, scaling considerations |

The docs writer generates these sections (all from researcher outputs and team context):

1. **Project Overview** — what it does, who uses it, tech stack summary
2. **Development Setup** — prerequisites, clone, install, environment config, first run, verification commands
3. **Architecture Overview** — module map, data flow, key abstractions, entry points
4. **Coding Conventions** — style, naming, file organization, rules summary
5. **Git & PR Workflow** — branching, commits, PR process, review expectations
6. **Testing Strategy** — test types, how to run, how to write, coverage expectations
7. **Key Workflows** — feature development, bug fixing, deployment, incident response
8. **Tribal Knowledge** — gotchas, common mistakes, non-obvious patterns, learnings
9. **Quick Reference** — cheat sheet with commands, file locations, key contacts, links

For role-specific guides, emphasize the relevant sections:
- **Frontend:** UI components, design system, browser testing, bundle optimization
- **Backend:** API design, database, auth, performance, observability
- **DevOps:** CI/CD, deployment, monitoring, infrastructure, secrets management
- **Fullstack / General:** balanced coverage across all sections

Present the complete guide for review.

**ASK:** "Here is the generated onboarding guide ({N} sections, ~{M} lines). Review before I write:

{section titles with one-line summaries}

Options:
- **Confirm** to write the guide
- **Adjust** specific sections (tell me what to change)
- **Add** a section I missed
- **Remove** a section that's not relevant"

---

### Step 6: Write Output

After the guide is confirmed:

1. **Markdown output** (default): Write the guide to `docs/onboarding/{role}-onboarding.md` (or `docs/onboarding/onboarding-guide.md` for general role). Create the `docs/onboarding/` directory if it does not exist.

2. **Issue output** (`issue`): Create a GitHub issue via `issue_write` with:
   - **Title:** `[Onboarding]: {Role} Developer Onboarding Guide`
   - **Labels:** `type:docs`, `area:onboarding`
   - **Body:** Full guide content

3. **Notion output** (`notion`): Write the guide as Notion-compatible markdown to `docs/onboarding/{role}-onboarding.md` with Notion toggle and callout syntax.

4. Present a summary of outputs:

```
Output:
  Guide:          {path or issue number}
  Sections:       {N} sections
  Role:           {role}
  Experience:     {level}
  Focus areas:    {areas}
  Gaps flagged:   {N} documentation gaps discovered
```

5. If documentation gaps were discovered during analysis, present them as recommendations:

```
Recommended Follow-ups:
  - [ ] Create CONTRIBUTING.md (not found)
  - [ ] Add .env.example (environment setup undocumented)
  - [ ] Document deploy process (currently tribal knowledge only)
  - [ ] Run hatch3r-codebase-map for detailed architecture documentation
  - [ ] Run hatch3r-project-spec for full project specification
```

---

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, generate the affected guide sections from available context (README, package manifest, directory structure) and note reduced accuracy. ASK the user how to proceed.
- **No README or setup docs:** Generate setup instructions from package manifest scripts and dependency analysis. Flag prominently in the guide that setup instructions are inferred, not documented, and may be incomplete. Recommend creating a README as a follow-up.
- **Multiple languages/frameworks:** Generate setup sections for each language/framework detected. Organize by language with shared prerequisites listed first. Note which parts of the codebase use which stack.
- **Missing credentials or access documentation:** Never invent or guess credentials. Include placeholder sections marked `[ACTION REQUIRED]` with instructions on who to contact for access. Flag each missing credential in the Recommended Follow-ups.
- **File write failure:** Report the error and provide the full guide content so the user can create the file manually.
- **Missing project context:** If no shared board context or `.agents/hatch.json` exists, proceed without board context — this command does not require board configuration.
- **Empty or minimal codebase:** If the project has fewer than 10 source files, generate a condensed guide without the architecture and tribal knowledge sections. Note that the guide will be more useful after the project matures.
- **Conflicting documentation:** If README instructions conflict with actual project structure or scripts, flag both versions in the guide and note the discrepancy for the developer to verify.

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Never include secrets, credentials, API keys, or tokens in the guide.** Use `[ACTION REQUIRED: obtain from {source}]` placeholders instead. If `.env.example` exists, reference it — do not copy actual `.env` values.
- **Always delegate research to the hatch3r-researcher agent protocol.** Researcher sub-agents handle codebase exploration and the tooling hierarchy internally.
- **Adapt depth to the developer's experience level.** Do not over-explain fundamentals for senior developers or assume knowledge for junior developers. Use the depth adjustments table in Step 5.
- **Flag missing documentation that should exist.** If standard project files (README, CONTRIBUTING, .env.example, CI config) are missing, note them in the Recommended Follow-ups.
- **All 3 researchers must complete before proceeding to Step 4.** Do not generate the guide from partial research.
- **Respect the project's tooling hierarchy** for knowledge augmentation: project docs first, then codebase exploration, then Context7 MCP, then web research.
- **Do not invent team norms.** If the user skipped team context questions in Step 1b, omit those sections rather than fabricating information about team processes.
- **Keep the guide actionable.** Every section should help the developer do something — run a command, find a file, follow a process. Avoid generic advice that could apply to any project.
- **Use exact commands and file paths.** Setup instructions must use the actual package manager, actual script names, and actual directory paths from the project. Never use generic placeholders when specific values are available from the codebase.

---

## Output Template

### Onboarding Guide Structure

```markdown
# {Project Name} — Developer Onboarding Guide

> **Role:** {role} | **Level:** {experience} | **Focus:** {areas}
> **Generated:** {date}

## 1. Project Overview
{What the project does, who uses it, tech stack table (Layer | Technology | Version)}

## 2. Development Setup
- Prerequisites checklist (runtime, package manager, tools — with versions and install methods)
- First-time setup (exact clone, install, env config, build, verification commands)
- Environment variables table (Variable | Purpose | Where to Get)
- Common setup issues table (Issue | Resolution)

## 3. Architecture Overview
- Annotated directory map (tree with purpose of each top-level dir)
- Data flow (how a typical request flows from entry point to response)
- Key abstractions table (Abstraction | Location | Purpose)

## 4. Coding Conventions
- Style & naming rules, file organization patterns
- Code review checklist

## 5. Git & PR Workflow
- Branch naming pattern with examples
- Commit message format with examples
- PR process steps (creation → review → merge — including CI requirements)

## 6. Testing
- Test types & commands table (Type | Command | Location)
- How to write tests (conventions, fixtures, mocking, coverage expectations)

## 7. Key Workflows
- Feature development (idea → merged PR)
- Bug fix (diagnose → fix → verify)
- Deployment (who, when, how, verification)

## 8. Tribal Knowledge
- Gotchas, common mistakes, non-obvious patterns table (Topic | What to Know)

## 9. Quick Reference
- Essential commands table (Action | Command)
- Key file locations table (What | Where)
- Contacts & resources table (Need Help With | Who / Where)

*Generated by hatch3r-onboard. Review and update as the project evolves.*
```

---

## Related

- **Agent:** `hatch3r-researcher` — performs parallel codebase analysis
- **Agent:** `hatch3r-docs-writer` — generates the guide document
- **Command:** `hatch3r-codebase-map` — deeper architecture documentation
- **Command:** `hatch3r-project-spec` — full project specification
- **Skill:** `hatch3r-feature` — standard feature development workflow (referenced in guide)
