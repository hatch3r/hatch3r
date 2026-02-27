---
id: hatch3r-rule-customize
type: command
description: Configure per-rule customization including scope overrides, description changes, enable/disable control, and project-specific markdown instructions
---
# Rule Customization — Per-Rule Configuration

Customize individual rule behavior for project-specific needs via `.hatch3r/rules/` configuration files. Supports structured YAML overrides (including scope changes) and free-form markdown instruction injection, all propagated to every adapter output on sync.

---

## Customization File Locations

Each rule supports two optional customization files:

```
.hatch3r/rules/{rule-id}.customize.yaml    # structured overrides
.hatch3r/rules/{rule-id}.customize.md      # free-form markdown instructions
```

Both files are optional and can be used independently or together.

## YAML Customization Schema

```yaml
rule: hatch3r-testing
scope: "src/**/*.ts,src/**/*.tsx"
description: "Testing rules with project-specific coverage requirements"
enabled: true
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | string | (from canonical) | Override when the rule applies. Use `always` for all files, or glob patterns (e.g., `src/**/*.ts`) |
| `description` | string | (from canonical) | Override the rule's description in adapter frontmatter |
| `enabled` | boolean | `true` | Set to `false` to exclude this rule from adapter output generation |

### Scope Override Examples

| Canonical Scope | Override | Effect |
|----------------|----------|--------|
| `always` | `src/**/*.ts` | Narrows rule from global to TypeScript files only |
| `src/**` | `always` | Broadens rule to apply to all files |
| `*.tsx` | `src/components/**/*.tsx` | Restricts to component files specifically |

## Markdown Customization

Create `.hatch3r/rules/{rule-id}.customize.md` with free-form markdown to inject project-specific rules into the rule's managed block. This content is appended after the canonical rule content under a `## Project Customizations` header.

### Example

**File:** `.hatch3r/rules/hatch3r-testing.customize.md`

```markdown
## Project-Specific Testing Requirements

### Coverage Targets

- Overall: 85% line coverage minimum
- Critical paths (payments, auth): 95% branch coverage
- New code: must not decrease overall coverage

### Test Framework

- Use Vitest for unit and integration tests
- Use Playwright for E2E tests
- Mock external services using MSW (Mock Service Worker)

### Database Tests

All tests touching the database must:
1. Use a dedicated test database (not dev or staging)
2. Run migrations before the test suite
3. Clean up test data after each test
```

### How It Works

1. During `hatch3r sync`, adapters read the `.customize.md` file
2. The markdown content is appended inside the managed block, after the canonical rule content
3. All adapter outputs receive the customization automatically
4. Changes propagate on every sync

## Disabling a Rule

To exclude a rule from adapter output without deleting its canonical file:

```yaml
# .hatch3r/rules/hatch3r-i18n.customize.yaml
enabled: false
```

The rule's canonical definition remains in `.agents/rules/` but no adapter output is generated for it.

## Workflow

1. Identify which rule to customize
2. Create `.hatch3r/rules/{rule-id}.customize.yaml` and/or `.customize.md`
3. Run `npx hatch3r sync` to propagate changes to all adapter outputs
4. Verify the customization appears in the tool-specific rule files

## Guardrails

- Scope overrides cannot weaken security-related rules (broadening scope is allowed, removing is not)
- Invalid YAML produces warnings but does not prevent rule application (graceful degradation)
- Customization files should be committed to the repository

## Related

- Agent customization: `hatch3r-agent-customize` command
- Skill customization: `hatch3r-skill-customize` command
- Command customization: `hatch3r-command-customize` command
