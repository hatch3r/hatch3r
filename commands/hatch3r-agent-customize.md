---
id: hatch3r-agent-customize
type: command
orchestrator: false
description: Override agent persona, model selection, preset enablement, and repo-file apply-scope via YAML plus markdown injection under .hatch3r/agents/
tags: [customize]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Agent Pipeline

This command runs as a single orchestrator without sub-agent delegation. Customization file management is performed inline.

# Agent Customization — Per-Agent Configuration

Customize individual agent behavior for project-specific needs via `.hatch3r/agents/` configuration files. Supports structured YAML overrides and free-form markdown instruction injection, all propagated to every adapter output on sync.

---

## Customization File Locations

Each agent supports two optional customization files:

```
.hatch3r/agents/{agent-id}.customize.yaml    # structured overrides
.hatch3r/agents/{agent-id}.customize.md      # free-form markdown instructions
```

Both files are optional and can be used independently or together.

## YAML Customization Schema

```yaml
agent: hatch3r-reviewer
model: claude-opus-4-6
description: "Security-focused code reviewer for healthcare platform"
enabled: true
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | (from canonical/manifest) | Override the agent's model preference |
| `description` | string | (from canonical) | Override the agent's description in adapter frontmatter |
| `enabled` | boolean | `true` | Set to `false` to exclude this agent from adapter output generation |

### Model Resolution Order

Model is resolved with the following priority (highest wins):

1. `.hatch3r/agents/{id}.customize.yaml` → `model`
2. `hatch.json` → `models.agents.{id}`
3. Canonical agent frontmatter → `model`
4. `hatch.json` → `models.default`

Model aliases are supported: `opus`, `sonnet`, `haiku`, `codex`, `gemini-pro`, etc.

## Markdown Customization

Create `.hatch3r/agents/{agent-id}.customize.md` with free-form markdown to inject project-specific instructions into the agent's managed block. This content is appended after the canonical agent definition under a `## Project Customizations` header.

### Example

**File:** `.hatch3r/agents/hatch3r-reviewer.customize.md`

```markdown
## Domain-Specific Review Rules

This is a healthcare SaaS platform handling PHI data.
All data must be encrypted at rest and in transit. HIPAA compliance is mandatory.

### Additional Review Checklist

- Verify no PHI in logs, error messages, or client responses
- All data stores use AES-256 encryption
- All data access is logged with user ID and timestamp

### Architecture Context

Microservices architecture with event sourcing.
Services communicate via RabbitMQ.
PostgreSQL for persistence, Redis for caching.
```

### How It Works

1. During `hatch3r sync` or `hatch3r init`, adapters read the `.customize.md` file
2. The markdown content is appended **inside** the managed block, after the canonical agent content
3. All adapter outputs (Cursor, Claude, Copilot, etc.) receive the customization automatically
4. Changes to `.customize.md` propagate on every sync — edit once, apply everywhere

### Resulting Adapter Output

The adapter wraps the result in hatch3r-managed block comments (literal markers omitted here so this file itself stays valid):

```markdown
[managed-block-start]
{canonical agent content}

---

## Project Customizations

{content from .customize.md}
[managed-block-end]
```

Replace `[managed-block-start]` / `[managed-block-end]` with the actual `<!-- HATCH3R\:BEGIN -->` / `<!-- HATCH3R\:END -->` markers in real adapter output.

Content placed **outside** the managed block markers by directly editing adapter output files is always preserved.

## Per-Agent Customization Examples

| Agent | Common Customizations |
|-------|----------------------|
| reviewer | Domain review checklists, severity focus, architecture context |
| security-auditor | Compliance requirements (HIPAA, SOC2, PCI), custom invariants |
| test-writer | Coverage targets, required test types, framework preferences |
| implementer | Architecture constraints, coding patterns, dependency restrictions |
| a11y-auditor | Additional WCAG criteria, custom accessibility requirements |
| perf-profiler | Custom performance budgets, monitoring tool guidance |
| dependency-auditor | Approved/denied dependency lists, update policies |
| docs-writer | Documentation templates, terminology glossary |
| lint-fixer | Custom lint rules, auto-fix preferences |
| ci-watcher | Custom CI job knowledge, failure pattern library |

## Disabling an Agent

To exclude an agent from adapter output without deleting its canonical file:

```yaml
# .hatch3r/agents/hatch3r-a11y-auditor.customize.yaml
enabled: false
```

The agent's canonical definition remains in `.agents/agents/` but no adapter output is generated for it.

## Protected Agents

Some agents have `protected: true` in their canonical frontmatter. This field marks agents whose core behavior must not be weakened or bypassed through customization, because they enforce critical quality and security invariants.

### Currently Protected Agents

| Agent | Why Protected |
|-------|--------------|
| `hatch3r-reviewer` | Enforces code quality, privacy invariants, and security review. Weakening or disabling it would allow unsafe code to merge unreviewed. |
| `hatch3r-security-auditor` | Enforces security rules, access control auditing, and privacy invariant verification. Disabling it would leave security gaps undetected. |
| `hatch3r-test-writer` | Enforces test coverage requirements and regression testing. Disabling it would allow untested code to ship. |

### What Protection Means

- **Cannot be disabled.** Setting `enabled: false` in a `.customize.yaml` file for a protected agent is ignored. The agent is always included in adapter output.
- **Cannot have scope or description overridden.** The `description` field in a `.customize.yaml` file is ignored for protected agents. Their canonical description is always used to prevent narrowing or misrepresenting the agent's responsibilities.
- **Model overrides ARE allowed.** You can override the `model` field for protected agents via `.customize.yaml` or `hatch.json`. Choosing a more capable model for a protected agent is a valid use case.
- **Markdown customization IS allowed.** You can add project-specific instructions via `.customize.md` (e.g., domain-specific review checklists, compliance requirements). These are appended to the canonical content and extend the agent's scope — they cannot reduce it.

### Frontmatter Format

```yaml
---
id: hatch3r-example-agent
description: Expert code reviewer for the project...
protected: true
model: standard
---
```

The `protected` field is set in the canonical agent definition and cannot be overridden by customization files.

## Workflow

1. Identify which agent to customize
2. Create `.hatch3r/agents/{agent-id}.customize.yaml` and/or `.customize.md`
3. Run `npx hatch3r sync` to propagate changes to all adapter outputs
4. Verify the customization appears in the tool-specific files (e.g., `.cursor/agents/`)

## Guardrails

- Customization files cannot remove the agent's core role or boundaries
- Invalid YAML produces warnings but does not prevent agent execution (graceful degradation)
- Customization files should be committed to the repository

## Unified Skill

This command's workflow is handled by the `hatch3r-customize` skill with `type: agent`. The skill provides root-cause analysis, multi-stakeholder review, and quality gate steps that extend the workflow above. Invoke the skill directly or use this command for the agent-specific reference documentation (model resolution, protected agents, per-agent examples).

## Related

- Skill customization: `hatch3r-skill-customize` command
- Command customization: `hatch3r-command-customize` command
- Rule customization: `hatch3r-rule-customize` command
- Model selection: [Model Selection](https://docs.hatch3r.com/docs/guides/model-selection) — configuration, aliases, resolution order
- Platform support: [Adapter Capability Matrix](https://docs.hatch3r.com/docs/reference/adapter-capability-matrix) — model emission per adapter (native vs guidance)
