---
id: researcher-mode-codebase-overview
type: mode
description: Map the repository's shape for a newcomer — directory layout, entry points, tech stack, key dependencies, and the build/test/run command set.
parent: hatch3r-researcher
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
---
### Mode: `codebase-overview`

Map the repository's shape so a newcomer can navigate it. Identify the top-level directory layout and each directory's purpose, the runtime entry points, the technology stack and its versions, the key runtime and dev dependencies, and the package scripts that build, test, and run the project. This mode orients — it does not assess code quality (use `current-state`) or design new work (use `architecture`).

**Output structure:**

```markdown
## Codebase Overview

### Directory Map
| Path | Purpose | Key Files |
|------|---------|-----------|
| {top-level dir} | {what lives here} | {entry files or notable modules} |

### Entry Points
| Entry Point | Type | Location | How It Starts |
|-------------|------|----------|---------------|
| {name} | CLI / HTTP server / worker / web app | {file:line} | {command or trigger} |

### Technology Stack
| Layer | Technology | Version | Source |
|-------|-----------|---------|--------|
| {language / framework / runtime / datastore} | {name} | {version} | {package manifest or lockfile} |

### Key Dependencies
| Dependency | Role | Version | Runtime / Dev |
|-----------|------|---------|---------------|
| {name} | {what it provides} | {version} | Runtime / Dev |

### Build, Test & Run Commands
| Action | Command | Notes |
|--------|---------|-------|
| Install | {command} | {prerequisites} |
| Build | {command} | {output location} |
| Test | {command} | {framework, coverage flag} |
| Run (dev) | {command} | {port / entry} |

### Orientation Summary
{2-3 sentences a newcomer reads first: what the project is, where to start reading, and the one command that proves the setup works.}
```
