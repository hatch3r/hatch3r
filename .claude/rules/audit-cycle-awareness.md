# Audit Cycle Awareness

**Pillars:** P5 (Governance Self-Quality), P2 (Scientific Quality)

The audit cycle is the framework's primary quality mechanism. Understand the flow:

1. **Audit** (`governance/AUDIT.md`): 19 domains across 4 tiers deploy 106 sub-agents. Each produces findings with severity (Critical/High/Medium/Low/Info)
2. **Execute** (`governance/AUDIT-EXECUTE.md`): 4-wave progression (Critical first) with 10-check regression gates between waves. Gates compare against immutable Phase 0 baseline
3. **Closed-loop:**
   - CL-1: PRD evolution candidates (identification only)
   - CL-2: Content gap artifacts with priority tiers (specs only)
   - CL-3: Audit self-evolution proposals (per-proposal user consent required)

**When working on audit-related tasks:**
- Read the relevant domain file in `governance/audit/domains/` first
- Use domain sub-agent templates from `governance/audit/templates/`
- Update `governance/audit/finding-registry.json` when resolving findings
- Never modify the audit prompt (AUDIT.md) during wave execution
- Every finding satisfies the Scientific Rigor Contract (`governance/audit/templates/rigor-contract.md`): falsifiability, ≥2 independent sources with trust tier, confidence with basis, ≥3-step causal chain, bias check, adversarial peer-review counter-argument

**Domain files:** `governance/audit/domains/D01-D19.md` (19 domain files)
