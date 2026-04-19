# Domain 12: CLI Diagnostics & Traceability

> Last updated: 2026-04-19

**Pillars served:** P1 (primary), P4 (supporting).

**Scope:** Can users understand what hatch3r did, diagnose problems, and trace generated output back to its source? This domain evaluates the framework's diagnostic and traceability capabilities appropriate for a setup-time CLI configuration generator.
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 12.1 | CLI Output Diagnostic Quality |
| 12.2 | Configuration Audit Trails |
| 12.3 | Agent Instruction Debugging |
| 12.4 | Content Traceability |

## Audit Checklists

### 12.1 CLI Output Diagnostic Quality
- [ ] Error messages include file path, severity, and actionable recovery steps for all CLI commands
- [ ] Users can distinguish errors from warnings from informational messages in all command output
- [ ] Progress feedback is informative without being noisy across init, sync, update, and validate commands
- [ ] Validation and verify commands produce structured, actionable output with clear pass/fail per check
- [ ] Dry-run mode available for destructive operations (sync overwrite, update content replacement)

### 12.2 Configuration Audit Trails
- [ ] Integrity manifest captures what changed, when, and by which CLI command (init/sync/update provenance)
- [ ] Users can diff between pre-sync and post-sync generated configuration state
- [ ] Provenance of each generated file is traceable: which adapter produced it, from which canonical source
- [ ] `hatch3r status` provides a complete health check of the current installation state
- [ ] Changes from customization (`.customize.yaml`, manual edits outside managed blocks) are distinguishable from framework-generated content

### 12.3 Agent Instruction Debugging
- [ ] Users can understand what instructions each adapter delivers to its target AI coding tool
- [ ] Content resolution rules are visible: which rules apply, in what order, with what overrides
- [ ] Generated output can be previewed before writing to disk (dry-run or preview mode)
- [ ] Customization overrides are surfaced in output so users can verify their customizations took effect

### 12.4 Content Traceability
- [ ] Users can trace any generated file back to its canonical source in `/.agents/`
- [ ] Managed block boundaries (`HATCH3R:BEGIN`/`HATCH3R:END`) are documented in generated output
- [ ] The transformation pipeline is visible: canonical artifact → adapter transformation → output file
- [ ] Content dependency chains are surfaced: agent X requires skill Y, command Z depends on MCP server W
