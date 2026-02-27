---
id: hatch3r-command-customize
type: command
description: Configure per-command customization including description overrides, enable/disable control, and project-specific markdown instructions
---
# Command Customization — Per-Command Configuration

Customize individual command behavior for project-specific needs via `.hatch3r/commands/` configuration files. Supports structured YAML overrides and free-form markdown instruction injection, all propagated to every adapter output on sync.

---

## Customization File Locations

Each command supports two optional customization files:

```
.hatch3r/commands/{command-id}.customize.yaml    # structured overrides
.hatch3r/commands/{command-id}.customize.md      # free-form markdown instructions
```

Both files are optional and can be used independently or together.

## YAML Customization Schema

```yaml
command: hatch3r-release
description: "Release workflow with mandatory staging deployment step"
enabled: true
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | (from canonical) | Override the command's description in adapter frontmatter |
| `enabled` | boolean | `true` | Set to `false` to exclude this command from adapter output generation |

## Markdown Customization

Create `.hatch3r/commands/{command-id}.customize.md` with free-form markdown to inject project-specific instructions into the command's managed block. This content is appended after the canonical command definition under a `## Project Customizations` header.

### Example

**File:** `.hatch3r/commands/hatch3r-release.customize.md`

```markdown
## Project-Specific Release Steps

Before creating any release:

1. Ensure all E2E tests pass on staging: `npm run test:e2e:staging`
2. Verify the changelog has been updated in `CHANGELOG.md`
3. Confirm the release has been approved in the `#releases` Slack channel
4. Tag the Docker image with the release version

### Deployment Sequence

Deploy in order: database migrations → API servers → worker processes → frontend CDN
```

### How It Works

1. During `hatch3r sync`, adapters read the `.customize.md` file
2. The markdown content is appended inside the managed block, after the canonical command content
3. All adapter outputs receive the customization automatically
4. Changes propagate on every sync

## Disabling a Command

To exclude a command from adapter output without deleting its canonical file:

```yaml
# .hatch3r/commands/hatch3r-cost-tracking.customize.yaml
enabled: false
```

## Workflow

1. Identify which command to customize
2. Create `.hatch3r/commands/{command-id}.customize.yaml` and/or `.customize.md`
3. Run `npx hatch3r sync` to propagate changes to all adapter outputs
4. Verify the customization appears in the tool-specific command files

## Guardrails

- Customization files cannot remove the command's core instructions
- Invalid YAML produces warnings but does not prevent command execution (graceful degradation)
- Customization files should be committed to the repository

## Related

- Agent customization: `hatch3r-agent-customize` command
- Skill customization: `hatch3r-skill-customize` command
- Rule customization: `hatch3r-rule-customize` command
