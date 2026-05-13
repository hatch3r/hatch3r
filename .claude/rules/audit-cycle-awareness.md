# Audit Cycle Awareness

**Pillars:** P5 (Governance Self-Quality), P2 (Scientific Quality)

The audit cycle is the framework's primary quality mechanism. Understand the flow:

1. **Audit** (`governance/AUDIT.md`): 20 domains across 4 tiers deploy 111 sub-agents. Each produces findings with severity (Critical/High/Medium/Low/Info)
2. **Execute** (`governance/AUDIT-EXECUTE.md`): 4-wave progression (Critical first) with **17-check** regression gates between waves. Each wave fans out **one sub-agent per finding** (same-file findings grouped into a file-lock sub-agent; same-wave dependency chains serialized). Sub-agents write to `.audit-workspace/wave-{N}/{finding_id}.results.md` per the Context Management Protocol; orchestrator reads only the wave SUMMARY.md. Gates compare against immutable Phase 0 baseline
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

**Domain files:** `governance/audit/domains/D01-D20.md` (20 domain files)
