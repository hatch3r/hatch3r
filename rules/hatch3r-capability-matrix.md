---
id: hatch3r-capability-matrix
type: rule
description: Per-cycle adapter capability matrix audit — twin metric currency + utilization. Surfaces unutilized platform-native features per adapter each cycle.
tags: [adapters, currency, capability, floor:content-quality]
precedence: high
scope: conditional
globs: "src/adapters/**,docs/adapter-capability-matrix.md"
---
# hatch3r Capability Matrix

**Pillars:** P3 (Adapter & External Tool Currency), CQ9 (Enhancability Quality)

## Twin Metric Model

Per cycle, every adapter (`src/adapters/{claude,cursor,copilot}.ts`) is measured on two metrics:

1. **Currency** — platform documentation date vs audit date delta (target ≤90 days)
2. **Capability utilization** — (covered platform features / total platform features) per adapter

Both metrics surface to D09 audit findings. Currency stale >90 days = Medium; capability utilization regression cycle-over-cycle = Medium.

## Capability Discovery Procedure

For each adapter, per cycle:

1. **Web-research** the platform's current documentation
2. **Enumerate native capabilities** in a normalised list: hooks, slash commands, MCP support, agent definitions, settings schema, rule format, prompt format, etc.
3. **Map current adapter utilization** per capability:
   - **utilized** — adapter emits / consumes this capability
   - **partially-utilized** — adapter emits a subset; gap documented
   - **unutilized** — capability exists, adapter does not use it
4. **Cross-reference** `docs/adapter-capability-matrix.md` static reference doc
5. **Surface unutilized capabilities** as audit findings (Info or Medium per value)

## Output Schema

```yaml
adapter: claude | cursor | copilot
cycle: <N>
date: YYYY-MM-DD
currency:
  source_doc_date: YYYY-MM-DD
  audit_date: YYYY-MM-DD
  delta_days: <int>
  source_url: https://...
capabilities:
  - name: <feature name>
    status: utilized | partially-utilized | unutilized
    coverage: <0.0-1.0 ratio if partially-utilized>
    finding_id: <if surfaced>
utilization_ratio: <int>/<int>  # covered / total
```

## Capability Categories (Per Adapter)

Each adapter's native capability surface enumerates across these categories — D09 SA-{Cursor, Claude, Copilot} maps each category per cycle:

| Category | Claude Code | Cursor | GitHub Copilot |
|----------|-------------|--------|----------------|
| Hooks / events | `.claude/settings.json` hooks (Pre/PostToolUse, SessionStart, etc.) | `.cursor/hooks/` | `.github/workflows/` agentic triggers |
| Slash commands | `.claude/commands/*.md` | `.cursor/commands/*.md` | `.github/prompts/*.md` |
| Agent definitions | `.claude/agents/*.md` | `.cursor/agents/*.md` | `.github/agents/*.md` |
| Rule format | `.claude/rules/*.md` | `.cursor/rules/*.mdc` | `.github/instructions/*.md` |
| MCP support | `.mcp.json` | `.cursor/mcp.json` | (limited / via VS Code settings) |
| Tool allowlist | per-agent `tools:` frontmatter | per-agent `tools:` | per-instruction file scope |
| Settings schema | `.claude/settings.json` | `.cursor/settings.json` | `.github/copilot-instructions.md` |

Each capability resolves to one of: utilized, partially-utilized, unutilized. Per-adapter SA cites the platform's official documentation URL + access date when classifying.

## Adapter-Capability-Matrix Static Reference

`docs/adapter-capability-matrix.md` is a maintained per-adapter feature table. The audit verifies the live matrix against the static doc and flags drift in either direction.

## Drift Detection

Per-cycle delta computation:

1. Load prior cycle's matrix from `governance/audit/execution-insights.json::d9_adapter_capability_matrix.{adapter}`
2. Compute `utilization_ratio` delta cycle-over-cycle
3. Regression (current < prior) = Medium finding with root-cause analysis required
4. Currency `delta_days > 90` = Medium finding per P3
5. Currency `delta_days > 180` = High finding (compounded staleness)

## CL-2 Routing for Unutilized Capabilities

D09 SA 9.4 (Capability Matrix Verification, SEQUENTIAL) aggregates unutilized capabilities across the 3 adapters and surfaces the top 3-5 highest-value gaps as CL-2 candidates for next-cycle adapter enhancement. Value scoring criteria:

- **High value:** capability unlocks a content type already in canonical corpus (e.g., MCP transport that lets canonical MCP rules emit natively)
- **Medium value:** capability improves end-user runtime efficiency (P7) or trust (P6) on emitted output
- **Low value:** capability has unclear end-user benefit; document and re-evaluate next cycle

## Cross-Reference

- `governance/audit/domains/D09-platform-adapters.md` — D09 SA-{Cursor, Claude, Copilot} per cycle runs this procedure
- `governance/audit/domains/D21-cli-tool-currency.md` — sibling cycle for CLI tool currency
- `.claude/rules/adapter-development.md` — adapter authoring conventions

## Pillar Service
- P3 — currency + utilization measured every cycle, no implicit drift
- CQ9 — every platform feature is a potential enhancement surface; this audit surfaces them

## References

- Anthropic, *Claude Code: hooks, agents, settings* — https://docs.claude.com/en/docs/claude-code/ (accessed 2026-05-26, trust tier: official-docs)
- Cursor, *Cursor docs: rules, agents, MCP* — https://cursor.com/docs (accessed 2026-05-26, trust tier: official-docs)
- GitHub, *Copilot custom instructions and prompts* — https://docs.github.com/en/copilot/customizing-copilot (accessed 2026-05-26, trust tier: official-docs)

