# Domain 15: Agentic Security & Trust Model

> Last updated: 2026-04-19

**Pillars served:** governance-axis P6 (primary), P2 (supporting); content-quality-axis CQ3 Security (primary).

**Scope:** The security of the agentic system itself — not the security guidance hatch3r teaches to end-user projects (covered in D5), but whether hatch3r's own architecture is resilient against agentic attack vectors. Includes trust delegation architecture and compliance mapping.

This is a distinct concern from Domain 1 (source code quality) and Domain 4 (production security). hatch3r generates instructions that guide AI agents with broad code-writing capabilities. The trust model of that system requires dedicated scrutiny.

**Sub-agents:** 8

| SA | Focus |
|----|-------|
| 15.1 | Prompt Injection & Instruction Integrity |
| 15.2 | Trust Boundaries Between Agents |
| 15.3 | OWASP Top 10 for Agentic Applications (ASI01-ASI10) |
| 15.4 | Supply Chain of Agent Definitions |
| 15.5 | MCP Trust Model |
| 15.6 | Agentic Trust Framework Compliance |
| 15.7 | CLI Tool Supply-Chain Trust |
| 15.8 | End-User Supply-Chain Floor Guidance Coverage |

## Domain Boundary

> D06 audits context engineering quality under normal operation (overflow, isolation, format validation). D15 audits context security under adversarial conditions (poisoning, injection, weaponization of user-controlled files). If a finding involves intentional malicious input, it belongs in D15.

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

**Specific source set (D15-targeted):** OWASP ASI 2026 (URL + access date), CVE feeds for MCP and agentic frameworks, vendor security advisories <=12 months old.

## Audit Checklists

> **Per-finding (Decision 17 / charter directive 18):** every finding declares `impact_horizon: short|medium|long` AND `progress_toward_pillar: <axis>.<pillar_id>+<delta>`; orchestrator DROPS at output time if either missing.

### 15.1 Prompt Injection & Instruction Integrity
- [ ] **Managed block injection** — Can malicious content injected outside `HATCH3R:BEGIN`/`HATCH3R:END` blocks influence agent behavior in ways that bypass hatch3r's intended instructions?
- [ ] **Customization override abuse** — Can `.hatch3r/{id}.customize.yaml` files override safety-critical agent behaviors (disabling security checks, bypassing the review loop)?
- [ ] **Skill injection** — Can a malicious user-installed skill in `.hatch3r/overrides/skills/` (or a compromised bundled skill in the installed npm package) escalate privileges, exfiltrate data, or override the orchestration pipeline?
- [ ] **Agent instruction tampering** — If an agent's `.md` file is modified (compromised dependency, malicious PR), what is the blast radius? What detects tampering? Drift detection (`hatch3r verify`) regenerates adapter outputs from the bundled canonical content and diffs against on-disk; npm package integrity is enforced via npm provenance (OIDC trusted publishing) + SHA-pinned dependency resolution.
- [ ] **Content system as attack vector** — Can tag/preset manipulation cause malicious content to be included in or excluded from initialization?

### 15.2 Trust Boundaries Between Agents
- [ ] **Agent isolation** — Do sub-agents operate within well-defined capability boundaries? Can the implementer bypass the reviewer?
- [ ] **Context propagation safety** — When rules and learnings are propagated to sub-agent prompts, is there filtering to prevent instruction injection?
- [ ] **Review loop integrity** — Can the fixer mark its own output as clean without the reviewer actually re-reviewing? Is the max-3-iteration limit enforceable or just advisory?
- [ ] **Escalation path reliability** — When max review iterations are reached with remaining findings, is user escalation reliable? Can it be suppressed?
- [ ] **Max-iteration enforcement** — Is the review loop iteration limit enforced at the infrastructure level or only by prompt instruction?

### 15.3 OWASP Top 10 for Agentic Applications (Self-Assessment)

Apply every category from the official OWASP Top 10 for Agentic Applications (ASI01-ASI10) to hatch3r's own agentic architecture.

- [ ] **ASI01: Agent Goal Hijack** — Can hatch3r agent objectives be altered through malicious content in project files, user prompts, or poisoned learnings? Can the orchestration pipeline be redirected?
- [ ] **ASI02: Tool Misuse & Exploitation** — Can agents misuse tools they have access to (file writes, git commands, GitHub API, MCP servers) through parameter pollution or tool chain manipulation? Are permissions minimized?
- [ ] **ASI03: Identity & Privilege Abuse** — Do agents inherit the user's full system credentials? Can a sub-agent escalate privileges beyond what its role requires (implementer gaining reviewer-level trust)?
- [ ] **ASI04: Agentic Supply Chain Vulnerabilities** — Are external components (MCP servers, npm dependencies, community packs, model APIs) validated? Could a compromised MCP server poison the pipeline?
- [ ] **ASI05: Unexpected Code Execution (RCE)** — Can agents be tricked into generating or executing malicious code? Does the implementer agent have RCE safeguards when writing code to the user's project?
- [ ] **ASI06: Memory & Context Poisoning** — Can the `.hatch3r/learnings/` system be poisoned to manipulate future agent behavior? Can corrupted context from one session persist and affect subsequent sessions?
- [ ] **ASI07: Insecure Inter-Agent Communication** — Are handoffs between agents (researcher to implementer, reviewer to fixer) validated? Can a compromised agent inject instructions into the next agent's prompt via its output?
- [ ] **ASI08: Cascading Failures** — If one agent in the pipeline fails (reviewer crashes), does the entire workflow fail gracefully or does it cascade? Are there circuit breakers or fallback behaviors?
- [ ] **ASI09: Human-Agent Trust Exploitation** — Does the framework create false confidence in agent output? Are users warned when agents are uncertain? Is the "0 Critical + 0 Warning" review gate trustworthy or can it be gamed?
- [ ] **ASI10: Rogue Agents** — Can an agent exhibit behavioral drift over long sessions? Can a sub-agent deviate from its defined role (implementer starting to review its own code)? Are there behavioral guardrails beyond prompt instructions?
- [ ] **Least-Agency check** — Each agent granted only the minimum autonomy required for its defined task. Reference OWASP 2026 ASI (https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/, accessed 2026-04-19).
- [ ] **Strong Observability check** — Goal state, tool-use patterns, and decision pathways logged with sufficient fidelity to reconstruct agent behavior post-hoc.

### 15.4 Supply Chain of Agent Definitions
- [ ] **Update integrity** — `hatch3r update` pulls bundled content from the npm package. Is npm provenance verified at install time? Are SHA-pinned dependencies enforced? Could a compromised npm publish inject malicious agent instructions despite provenance (e.g., compromised maintainer OIDC token)?
- [ ] **Pack system security** — The `hatch3r add [pack]` feature installs community-authored content. What is the trust model for community packs? Is there sandboxing, review, or signing?
- [ ] **Version pinning** — Can users pin to a specific version of agent content to avoid unexpected behavioral changes?
- [ ] **Drift-detection tamper sensitivity** — Does `hatch3r verify` (regenerate canonical → diff on-disk) reliably detect tamper attempts on adapter outputs? What is the false-negative rate when a managed block has been modified outside `HATCH3R:BEGIN`/`HATCH3R:END` markers?

### 15.5 MCP Trust Model
- [ ] MCP server trust model — how are MCP servers authenticated and authorized?
- [ ] MCP server capability scoping — are MCP server permissions minimized?
- [ ] Malicious MCP server scenarios — what happens if a registered MCP server is compromised?
- [ ] MCP transport security — are connections encrypted and authenticated?
- [ ] MCP tool permission model — can individual MCP tools be allowed/denied?
- [ ] **MCP server version pinning** — are MCP server versions pinned in mcp.json to prevent supply chain attacks via auto-updated servers?
- [ ] **Tool poisoning via MCP** — can a compromised MCP server inject malicious tool descriptions that manipulate agent behavior? (MCP vulnerabilities surged 270% in Q3 2025)
- [ ] **MCP STDIO sanitization** — MCP server invocations use parameterized arguments with shell-escaped inputs. Verified against the 2026 by-design RCE disclosure (https://www.securityweek.com/by-design-flaw-in-mcp-could-enable-widespread-ai-supply-chain-attacks/, https://www.ox.security/blog/the-mother-of-all-ai-supply-chains-critical-systemic-vulnerability-at-the-core-of-the-mcp/; accessed 2026-04-19).
- [ ] **MCP server auto-update disabled** — Auto-update channel disabled OR versions constrained in `mcp.json` per supply-chain guidance.

### 15.6 Agentic Trust Framework Compliance
- [ ] Agentic Trust Framework compliance assessment — does hatch3r's trust model align with the emerging framework?
- [ ] Trust delegation — how is trust delegated from user to agent to sub-agent?
- [ ] Trust verification — how is agent behavior verified against expected behavior?
- [ ] Trust revocation — can trust be revoked for misbehaving agents?
- [ ] Verify trust reference against current implementation in `src/pipeline/` (see [D15-trust-reference.md](D15-trust-reference.md))

### 15.7 CLI Tool Supply-Chain Trust
- [ ] **Installer chain integrity** — `hatch3r-cli-{id}` skill install recipes resolve to vendor-signed channels (brew bottles, apt signed-by, scoop manifests, winget manifests, cargo crates registry, npm). Unsigned install paths are a High finding.
- [ ] **Version pinning** — `## Detection / Install` body pins a tested-against version per OS channel; floating `latest` recommendations for tier-1 tools are a Medium finding per CONSTITUTION.md §2 P3.
- [ ] **CVE check window** — every tier-1 tool has a NVD + GitHub Security Advisory scan ≤90 days from cycle date (D21 owns the scan; D15.7 verifies the audit trail). Missing CVE check is High.
- [ ] **Tool provenance** — vendor, source-code repository URL, and license recorded in `src/cliTools/registry.ts` entry; provenance gaps are a Medium finding.
- [ ] **Sandbox escape surface** — for browser/sandbox tools (playwright, docker, container-use), verify the recommended invocation pattern in the skill body does not expose the host filesystem or credentials beyond the documented scope; over-broad mount or credential pass-through is a High finding.

### 15.8 End-User Supply-Chain Floor Guidance Coverage

Scope: whether hatch3r's end-user content (rules, skills, commands, agents) teaches the 2026 supply-chain floor — distinct from SA15.7 (hatch3r's own recommended CLI tools).

- [ ] **npm provenance** — end-user content mandates `npm publish --provenance` or Trusted Publishing OIDC for libraries published from user repositories. Missing mandate is a High finding.
- [ ] **SBOM generation** — end-user content mandates CycloneDX 1.6 or SPDX 3.0.1 SBOMs on releases with named tooling (`npm sbom`, `cdxgen`, `syft`). Missing tooling reference is a High finding.
- [ ] **SLSA build provenance** — end-user content mandates SLSA v1.0+ Build L3 via `slsa-github-generator` or equivalent for release pipelines. Missing mandate is a High finding.
- [ ] **Malicious-package detection** — end-user content mandates a layer beyond `npm audit` (socket.dev / Snyk / OSV-Scanner) plus pnpm `minimumReleaseAge` config or equivalent. Missing layered defense is a High finding.
- [ ] **Pinned Action SHAs** — end-user content mandates 40-character commit SHA pinning on every `uses:` line, with Renovate / Dependabot auto-update; cites CVE-2025-30066 (tj-actions) as the lesson. Tag-only references are a High finding.
- [ ] **Container hardening** — end-user content mandates Wolfi/Chainguard or distroless base, digest pinning, non-root user, cosign signing, SBOM-in-image. Missing any control is a Medium finding; missing signing or digest pinning is High.
- [ ] **OIDC cloud auth** — end-user content mandates OIDC trusted federation for CI cloud auth with no long-lived secrets. Long-lived-secret guidance is a High finding.
- [ ] **License allow-list** — end-user content mandates SPDX allow-list (MIT, Apache-2.0, ISC, BSD-2/3-Clause, MPL-2.0, CC0-1.0) and denies copyleft (GPL, AGPL, SSPL) unless justified, enforced via `license-checker` or equivalent CI gate. Missing allow-list is a Medium finding.
- [ ] **Tiered floor mandates (Decision 4):** for each floor item (npm provenance, SBOM, SLSA, malicious-pkg detection, SHA-pin, container hardening, OIDC, license allow-list), evaluate maturity-tier applicability. Solo defers items without security blast radius (SBOM emit, license allow-list); team+ enforces uniformly. Flag mandates currently tier-uniform that should be tier-conditional per Decision 4 audience model.

Cross-references: `rules/hatch3r-dependency-management.md`, `rules/hatch3r-secrets-management.md`, `rules/hatch3r-container-hardening.md`, `rules/hatch3r-ci-cd.md`.

> Trust delegation chain and compliance mapping have moved to [D15-trust-reference.md](D15-trust-reference.md) (governed appendix).
