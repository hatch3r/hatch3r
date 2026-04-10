# hatch3r — Development Instructions

> This file governs framework development. It is NOT generated output — it is the agentic setup for developing hatch3r itself.

hatch3r is an open-source CLI (TypeScript, Commander.js) that generates tool-agnostic agentic coding setups for 15 AI coding tools from a canonical source model (`.agents/`) and platform adapters.

---

## Architecture

| Directory | Contents |
|-----------|----------|
| `src/cli/commands/` | 11 CLI commands: init, sync, status, update, validate, verify, config, clean, add, worktree-setup, worktree-cleanup |
| `src/adapters/` | 15 platform adapters: cursor, claude, copilot, cline, windsurf, gemini, codex, opencode, amp, aider, kiro, goose, zed, amazonq, antigravity |
| `src/pipeline/` | 14 pipeline modules: adapterTimeout, agentIdentity, agentToolAllowlist, circuitBreaker, complianceVerification, diffHash, failureLog, observability, phaseOutputSchema, phaseTimeout, pipelineContext, pipelineTimeout, promptGuard, reviewLoop |
| `src/content/` | Content indexing, presets (minimal/standard/full), tag system |
| `src/merge/` | Safe write (temp+rename atomic), managed block tracking |
| `src/integrity/` | SHA-256 file integrity, manifest-level checksum |
| `agents/` `skills/` `rules/` `commands/` `hooks/` | Canonical content artifacts (16 agents, 26 skills, 26 rules, 34 commands, 6 hooks) |
| `checks/` `prompts/` `github-agents/` | Additional content: 5 checks, 3 prompts, 4 github-agents |
| `governance/` | 6 Binding Pillars, 19 audit domains, audit cycle, closed-loop phases |
| `.claude/` | Rules, skills, hooks for framework development |

Entry: `src/cli/index.ts` | Build: tsup to `dist/` | Test: vitest | Lint: eslint

---

## Development Commands

```
npm test                    # vitest (global: 78/65/80/80 stmt/branch/func/line)
npm run lint                # eslint
npx tsc --noEmit            # typecheck
npm run build               # tsup
npx hatch3r validate        # content structure + frontmatter + cross-ref
```

Critical module thresholds: `src/merge/` `src/integrity/` (90/80/90/90), `src/content/` `src/adapters/customization.ts` (85/75/85/85).

Commits: Conventional Commits (`feat|fix|refactor|test|docs|chore|audit(scope): msg`), DCO sign-off required (`git commit -s`).

---

## The 6 Binding Pillars

Every change must serve at least one pillar. Full definitions: `governance/CONSTITUTION.md`.

| Pillar | Name | Enforcement | Primary Ref |
|--------|------|-------------|-------------|
| P1 | CLI UI/UX Excellence | Actionable errors, progressive disclosure, first-run success | D10 |
| P2 | Scientific & Practical Quality | Adversarial thinking, root-cause orientation, measurable criteria | D1,D5,D7,D13 |
| P3 | Adapter & MCP Currency | Web-research platform docs each cycle, staleness is a finding | D2,D9 |
| P4 | Comprehensive Lean Coverage | No bloat, no duplication, single-source-of-truth, every file earns existence | D5,D16 |
| P5 | Governance Self-Quality | Governance passes its own tests, anti-slop, lean thresholds | D16,D18,D19 |
| P6 | Security & Trust Governance | OWASP ASI compliance, trust delegation, prompt injection guards | D15 |

**Pillar Compliance Test** (required for governance/content changes):
1. Which pillar(s) does this change serve? If none → reject.
2. What measurable improvement does it produce?
3. Does it increase governance size? If yes → justify net value exceeding size cost.

---

## Governance References

| File | Purpose |
|------|---------|
| `governance/VISION.md` | North star: identity, audience, quality bar, principles |
| `governance/CONSTITUTION.md` | Design rationale: 6 pillars, traceability matrix, lean thresholds |
| `governance/AUDIT.md` | Audit prompt: 19 domains, 106 sub-agents, behavioral charter |
| `governance/AUDIT-EXECUTE.md` | Execution: 4-wave model, regression gates, closed-loop phases |
| `governance/RE-ENVISION.md` | Vision capture/refinement prompt |
| `governance/audit/domains/D01-D19` | Domain definitions with sub-agent checklists |

Content fixes flow through the audit cycle (AUDIT.md then AUDIT-EXECUTE.md). No ad-hoc governance edits.

---

## Anti-Slop Wordlist

Zero tolerance in all `.md` files under `governance/`, `agents/`, `commands/`, `rules/`, `skills/`, `hooks/`. FAIL if any appear without measurable qualifier:

| Banned | Use Instead |
|--------|-------------|
| "best possible", "best-in-class", "world-class" | Specific measurable target |
| "comprehensive and thorough", "exhaustive" | Specific scope statement |
| "robust and resilient" | Named resilience pattern (circuit breaker, retry with backoff) |
| "high-quality" (no measure) | Specific quality metric |
| "ensure" (no method) | Specific verification step |
| "properly", "correctly" (no criterion) | Specific passing condition |
| "as needed", "as appropriate" (no trigger) | Specific trigger condition |
| "scalable" (no dimension) | Specific scale target (N users, M repos) |
| "carefully", "thoroughly" | Remove or replace with specific action |
| "it is important to note", "this section describes" | Remove — state the thing directly |

---

## Key Patterns

- **Adapter:** Extend `BaseAdapter` (`src/adapters/base.ts`), implement `doGenerate()`, use `readCanonicalFiles()`, `applyCustomization()`, `wrapInManagedBlock()`, register in `src/adapters/index.ts`
- **Safe writes:** Temp file + atomic rename via `src/merge/safeWrite.ts`
- **Managed blocks:** `HATCH3R:BEGIN`/`HATCH3R:END` markers preserve user content during updates
- **Pipeline:** Circuit breaker (transient vs substantive failure), prompt guard (500KB input/1MB output), phase timeouts, tool allowlists per agent
- **Content frontmatter:** YAML with `id`, `type`, `description`, `tags`; `hatch3r-` filename prefix
- **Integrity:** SHA-256 per-file + manifest-level checksum in `hatch.json`

---

## Lean Thresholds

From `governance/CONSTITUTION.md` §2 P5:

| Metric | Limit |
|--------|-------|
| CONSTITUTION.md | <=200 lines |
| AUDIT.md | <=600 lines |
| AUDIT-EXECUTE.md | <=700 lines |
| Domain file | 30-80 lines |
| Cross-file duplication | <5% |
| Anti-slop phrases | 0 per file |
| Checklist items/sub-agent | 4-8 |

---

## Rules & Skills

- **Rules:** `.claude/rules/` — Loaded automatically each session. Enforce pillar-specific constraints.
- **Skills:** `.claude/skills/` — Invokable as `/skill-name`. Development workflow automation.
- **Hooks:** `.claude/settings.json` — SessionStart loads governance context, Pre/PostToolUse inject reminders.
