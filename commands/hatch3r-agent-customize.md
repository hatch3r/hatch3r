---
id: hatch3r-agent-customize
type: command
description: Configure per-agent customization including model overrides, description changes, and project-specific markdown instructions
---
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

```markdown
<!-- HATCH3R:BEGIN -->
{canonical agent content}

---

## Project Customizations

{content from .customize.md}
<!-- HATCH3R:END -->
```

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

## Workflow

1. Identify which agent to customize
2. Create `.hatch3r/agents/{agent-id}.customize.yaml` and/or `.customize.md`
3. Run `npx hatch3r sync` to propagate changes to all adapter outputs
4. Verify the customization appears in the tool-specific files (e.g., `.cursor/agents/`)

## Guardrails

- Customization files cannot remove the agent's core role or boundaries
- Invalid YAML produces warnings but does not prevent agent execution (graceful degradation)
- Customization files should be committed to the repository

## Related

- Skill customization: `hatch3r-skill-customize` command
- Command customization: `hatch3r-command-customize` command
- Rule customization: `hatch3r-rule-customize` command
- Model selection: [docs/model-selection.md](../docs/model-selection.md) — configuration, aliases, resolution order
- Platform support: [docs/adapter-capability-matrix.md](../docs/adapter-capability-matrix.md) — model emission per adapter (native vs guidance)
