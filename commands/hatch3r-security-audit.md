---
id: hatch3r-security-audit
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-dependency-auditor, hatch3r-security]
description: Open an OWASP ASI security epic reviewing auth boundaries, input validation, and supply-chain risks with one hardening sub-issue per module plus trust-boundary audit
tags: [maintenance, floor:security]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
triage_tiers: [2, 3]
sub_agents_spawned:
  count: 3
  rationale: Module-taxonomy discovery and audit-sub-issue authoring delegate to `hatch3r-implementer`; the two cross-cutting security axes fan out in parallel to `hatch3r-dependency-auditor` (supply-chain + dependency-CVE posture) and `hatch3r-security` (CQ3 OWASP ASI01-10 coverage). Fan-out is disjoint across module and cross-cutting axes; serialization would violate P8 B2 task decomposition. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Agent Pipeline

This command discovers the module taxonomy via static analysis, then delegates security-audit sub-issue authoring and two cross-cutting security axes to parallel sub-agents via the Task tool. Pipeline:

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context & Pre-flight | Orchestrator (inline) | No | Yes |
| 2. Module Audit Authoring | `hatch3r-implementer` (one Task call per module sub-issue body) | Yes (across modules) | Yes |
| 3. Cross-Cutting Security Axes | `hatch3r-dependency-auditor` + `hatch3r-security` (parallel sub-issue authoring) | Yes | Yes |
| 4. Issue Creation | Orchestrator (GitHub MCP) | No | Yes |
| 5. Board Sync | Orchestrator (Projects v2 sync) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

All issue operations MUST follow the Projects v2 Enforcement rules defined in `hatch3r-board-shared`.

Sub-agent fan-out scales with module count per `rules/fan-out-discipline.md` (P8 B2). For each discovered module, a `hatch3r-implementer` Task call authors that module's security-audit sub-issue body in parallel; the two cross-cutting audits (`hatch3r-dependency-auditor` for supply-chain, `hatch3r-security` for OWASP ASI01-10) run as one parallel batch.

## Triage

Classify the security-audit request before fan-out:

- **Tier 2 (standard)**: single repository with discovered module count <=8; parallel module sub-agents bounded by `max_phase4_parallel`.
- **Tier 3 (deep)**: monorepo with module count >8 OR cross-module trust-boundary depth >=3; same fan-out shape, longer review loop.

Tier is derived from Module Discovery output (Step 2). Tier 1 is not supported — single-target security fixes belong to `hatch3r-quick-change` with a `hatch3r-security-auditor` Phase 4 gate.

### Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 4 module audit-authoring fan-out), surface the cost preview so a wide module fan-out is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Tier derived from module count:

```yaml
cost_estimate:
  expected_sa_count: <module count + 2 cross-cutting axes; Tier 2 ~module-count<=8, Tier 3 module-count>8, bounded by max_phase4_parallel per batch>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 6 finalization summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering derives from discovered module count, which can misclassify — a monorepo with many small modules over-scored, or a dense single-package repo under-scored. The user override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

- `--effort=standard|deep` forces the named tier, bypassing the module-count auto-classification. `--effort=light` is rejected — Tier 1 is unsupported here (single-target security fixes route to `hatch3r-quick-change`).
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the module-count auto-classification stands.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every authored module-audit sub-issue body and each cross-cutting axis finding MUST carry a high/medium/low confidence rating sourced from the authoring sub-agent. Severity classifications (critical/high/medium/low) are distinct from and additional to this confidence signal. Dropping the confidence signal between stages is a gate failure.

# Security Audit — Full Product Security Audit

Create a security audit epic on **{owner}/{repo}** with one sub-issue per logical project module, plus cross-module trust boundary and OWASP alignment audits. Each sub-issue is a deep static-analysis security audit task that, when picked up by the board workflow, produces a findings epic with actionable sub-issues for hardening application security. The command only creates the initial audit epic — it does NOT execute any audits.

---

## Shared Context

**Read the project's shared board context at the start of the run** (e.g., `commands/hatch3r-board-shared/SKILL.md` or equivalent). It contains GitHub Context, Project Reference, Projects v2 sync procedure, and Board Overview template. Cache all values for the duration of this run.

## Token-Saving Directives

Follow any **Token-Saving Directives** in the shared context file.

---

## Module Discovery

The product is divided into logical modules. Discover modules from the project structure:

1. **Scan for modules:** Inspect top-level directories (e.g., `src/`, `functions/`, `packages/`) and identify logical units.
2. **Map to security specs:** If `docs/specs/` exists, map each module to relevant security-related spec files (threat model, permissions, data model, privacy docs). If no security-specific specs exist, note the gap.
3. **Build taxonomy:** Produce a table of modules with their directories and security-relevant specs.

Example structure (adapt to project):

| # | Module | Directories | Security Specs |
|---|--------|-------------|----------------|
| 1 | Auth | `src/auth/` | `05_permissions.md`, `09_threat-model.md` |
| 2 | API | `functions/api/` | `04_api-design.md` |
| ... | ... | ... | ... |

Plus two cross-cutting audits:

| # | Audit | Scope |
|---|-------|-------|
| T | Cross-Module Trust Boundaries | Trust assumptions, data flow security, privilege escalation paths across modules |
| O | OWASP Top 10 & Compliance Alignment | OWASP Top 10 coverage, infrastructure security, deployment configuration |

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Load Context & Pre-Flight Check

1. Read the shared board context and cache GitHub Context, Projects v2 config, and sync procedure.
2. If security-relevant documentation exists (threat model, permissions spec, privacy docs), read the first 30 lines of each for TOC/section headers.
3. Scan for existing security audit epics: `search_issues` with `owner: {owner}`, `repo: {repo}`, query `label:meta:security-audit state:open`.
4. If an open security audit epic exists:

**ASK:** "An open security audit epic already exists: #{number} — {title}. (a) Abort, (b) close the existing one and create a new security audit, (c) proceed and create a second security audit."

5. Fetch all open issues (`list_issues`, paginate, exclude `meta:board-overview`). Cache for Board Overview regeneration in Step 7.

---

### Step 2: Determine Audit Modules

1. Build the module taxonomy from directory structure (see Module Discovery above).
2. If the user specified specific modules in their invocation, filter the taxonomy to only those modules. The two cross-cutting audits (Trust Boundaries, OWASP) are always included unless the user explicitly excludes them.
3. Validate that the directories for each selected module exist in the workspace. Warn if any directory is missing.

Present the selected modules:

```
Security Audit Scope:

Level 1 (parallel):
  1. {Module 1} — {path}/
  2. {Module 2} — {path}/
  ...

Level 2 (after all Level 1 complete):
  T. Cross-Module Trust Boundaries — trust assumptions + data flow security
  O. OWASP Top 10 & Compliance Alignment — OWASP coverage + infrastructure
```

**ASK:** "These modules will be audited for security. Confirm, add, or remove modules."

---

### Step 3: Create Security Audit Epic

Create the parent epic via `issue_write` with `method: create`, `owner: {owner}`, `repo: {repo}`.

**Title:** `[Security Audit]: Full Product Security Audit`

**Labels:** `type:epic`, `meta:security-audit`, `status:ready`, `executor:agent`, `priority:p0`, `area:security`

**Body:**

```markdown
## Overview

Full-product security audit covering {N} logical modules plus cross-module trust boundary analysis and OWASP Top 10 alignment. Each sub-issue performs a deep static security analysis of one module across 8 security domains and produces a findings epic with actionable sub-issues for hardening application security.

## Sub-Issues

### Level 1 — Module Security Audits (parallel)

- [ ] #{part-1} — Security Audit: {Module 1}
- [ ] #{part-2} — Security Audit: {Module 2}
      ...

### Level 2 — Cross-Cutting Security Audits (after all Level 1)

- [ ] #{trust} — Security Audit: Cross-Module Trust Boundaries
- [ ] #{owasp} — Security Audit: OWASP Top 10 & Compliance Alignment

## Implementation Order

### 1

- [ ] #{part-1} — Security Audit: {Module 1}
- [ ] #{part-2} — Security Audit: {Module 2}
      ...all module audits...

### 2 -- after #{part-1}, #{part-2}, ... #{part-N}

- [ ] #{trust} — Security Audit: Cross-Module Trust Boundaries
- [ ] #{owasp} — Security Audit: OWASP Top 10 & Compliance Alignment

## Acceptance Criteria

- [ ] All sub-issue security audits completed
- [ ] One findings epic created per audited module (with `meta:security-audit-findings` label)
- [ ] All findings epics have sub-issues with acceptance criteria
- [ ] All findings epics integrated into Projects v2 board
- [ ] Cross-cutting findings epics have correct dependencies on module findings epics
- [ ] All critical/high severity findings have sub-issues (none suppressed)

## Dependencies

None.
```

Record the returned `number` and internal numeric `id` for the epic.

---

### Step 4: Create Module Security Audit Sub-Issues

For each module in the selected taxonomy, create a sub-issue via `issue_write` with `method: create`.

**Title:** `Security Audit: {Module Name}`

**Labels:** `type:security-audit`, `status:ready`, `executor:agent`, `priority:p0`

**Body:** Use the Module Security Audit Sub-Issue Template below, filling in the module-specific fields.

After creating each sub-issue, link it to the parent epic via `sub_issue_write` with `method: add`, using the parent `issue_number` and the child's internal numeric `id`.

Record all returned sub-issue numbers for use in Step 5.

#### Module Security Audit Sub-Issue Template

```markdown
## Security Audit: {Module Name}

> Parent: #{security-audit-epic-number} — [Security Audit]: Full Product Security Audit

### Scope

**Directories:** {comma-separated directory paths from taxonomy}
**Security Specs:** {security-relevant spec filenames from taxonomy, or "None — flag as gap" if missing}
**Test Directories:** Search `tests/rules/`, `tests/security/`, `tests/integration/`, `tests/e2e/` for security-related test files matching this module.

### Audit Protocol

Perform a deep static security analysis of this module. Do NOT execute tests or modify code — review source files, spec documents, configuration, and existing security test files only.

#### 1. Authentication & Authorization

- Identify all auth flows within this module (login, token refresh, session creation)
- Verify auth tokens are validated on every protected endpoint or entry point
- Check session management: expiry, rotation, invalidation on logout/password change
- Assess RBAC/permission enforcement: are role checks server-side and consistent?
- Look for privilege escalation paths: can a lower-privilege user reach higher-privilege operations?

#### 2. Input Validation & Sanitization

- Identify all external input entry points (API params, form fields, URL params, file uploads, headers)
- Check for injection vulnerabilities: XSS, SQL injection, NoSQL injection, command injection, template injection
- Verify type coercion and boundary validation at module entry points
- Assess encoding/escaping before output (HTML, JSON, SQL, shell)
- Check file upload handling: type validation, size limits, path traversal prevention

#### 3. Data Protection & Privacy

- Check encryption: data at rest (database fields, file storage) and in transit (TLS enforcement)
- Identify PII handling: what personal data flows through this module?
- Verify data exposure: are responses filtered to exclude sensitive fields?
- Check logging hygiene: no PII, tokens, passwords, or sensitive data in log output
- Assess privacy invariant adherence per project security/privacy docs
- Check data retention and deletion capabilities

#### 4. Access Control

- Audit database/storage security rules for this module's collections/tables
- Verify least privilege: does each operation use minimum required permissions?
- Check entitlement enforcement: are entitlements validated server-side only?
- Assess file/resource permission models
- Look for direct object reference vulnerabilities (IDOR)

#### 5. Secret Management

- Scan for hardcoded secrets, API keys, credentials, or tokens in source files
- Verify environment variable usage for all secrets and configuration
- Check for secret exposure in error messages, stack traces, or client-side bundles
- Assess secret rotation capabilities and documentation
- Verify `.gitignore` and build pipeline exclude sensitive files

#### 6. Error Handling & Information Leakage

- Check error responses: no stack traces, internal paths, or system info exposed to clients
- Verify debug endpoints and verbose logging are disabled in production configuration
- Assess error messages for sensitive data leakage (user IDs, internal state, query details)
- Check for catch-all error handlers that may swallow security-relevant failures silently
- Verify logging captures security events (auth failures, permission denials, anomalous input)

#### 7. API & Endpoint Security

- Verify auth is enforced on all endpoints (no unprotected routes serving sensitive data)
- Check rate limiting configuration on auth and sensitive endpoints
- Assess CORS configuration: is it restrictive and intentional?
- Verify response filtering: no over-fetching of data sent to clients
- Check webhook endpoints for signature verification
- Assess API versioning and deprecation for security implications

#### 8. AI & Agentic Security (OWASP Agentic Top 10)

- **ASI01 — Agent Goal Hijack:** Check for system prompt leakage, input sanitization before LLM processing, instruction hierarchy enforcement, indirect prompt injection via retrieved content
- **ASI02 — Tool Misuse & Exploitation:** Verify tool access controls, parameter validation on tool calls, deny-by-default tool permissions, tool call rate limiting
- **ASI03 — Identity & Privilege Abuse:** Check for unique agent identification, action attribution, non-repudiation mechanisms, agent impersonation prevention
- **ASI04 — Supply Chain Vulnerabilities:** Audit MCP server sources, version pinning, package integrity verification, auto-install risks (npx -y)
- **ASI05 — Unexpected Code Execution:** Check for sandboxed execution environments, code review before execution, restricted file system access, network isolation
- **ASI06 — Memory & Context Poisoning:** Verify context validation before reuse, memory expiry mechanisms, tamper detection for stored agent state, RAG content validation
- **ASI07 — Insecure Inter-Agent Communication:** Check agent-to-agent authentication, scoped delegation tokens, message integrity, privilege boundaries between agents
- **ASI08 — Cascading Failures:** Assess error propagation across agent chains, circuit breakers, timeout enforcement, blast radius containment
- **ASI09 — Human-Agent Trust Exploitation:** Verify confirmation checkpoints for destructive actions, cost limit enforcement, social engineering resistance, action transparency
- **ASI10 — Rogue Agents:** Check for behavioral monitoring, output validation, scope enforcement, kill switches, anomaly detection

### Output — Findings Epic

After completing the audit, create a findings epic on GitHub.

**Create via `issue_write`:**

- **Title:** `[Security Findings]: {Module Name}`
- **Labels:** `type:epic`, `meta:security-audit-findings`, `status:ready`, `executor:agent`, `priority:p0`
- **Body:** Overview of findings count and severity, sub-issues checklist, implementation order, acceptance criteria ("done when all finding sub-issues are resolved").

**Create sub-issues** — one per actionable finding. Each must include:

- Security domain reference (1–8) for traceability
- Problem description with evidence (file paths, line references, spec section)
- Risk assessment: severity (critical/high/medium/low), exploitability, blast radius
- Suggested fix approach
- Acceptance criteria (specific and testable)
- Labels: `type:bug` for vulnerabilities, `type:security-audit` for hardening improvements, plus `area:security` and relevant `area:*` label

**Link sub-issues** to the findings epic via `sub_issue_write`.

**Board integration** — for the findings epic and every sub-issue:

Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary). Set status to Ready using the project's status field option ID.

### Completion

Return to the parent orchestrator with:

- Findings epic issue number
- Total findings count
- Breakdown by security domain (1. Auth, 2. Input, 3. Data, 4. Access, 5. Secrets, 6. Errors, 7. API, 8. AI/Agentic)
- Severity distribution (critical / high / medium / low)
- Any blockers encountered
```

---

### Step 5: Create Cross-Cutting Security Audit Sub-Issues

Create two additional sub-issues with dependencies on all module audit sub-issues.

#### 5a. Cross-Module Trust Boundaries Audit

**Title:** `Security Audit: Cross-Module Trust Boundaries`

**Labels:** `type:security-audit`, `status:ready`, `executor:agent`, `priority:p0`, `has-dependencies`

**Body:** Scope: Analyze trust assumptions and security boundaries between all project modules. This audit runs AFTER all module audits complete — use their findings for additional context.

Audit areas:
- Trust assumptions: which modules trust input from other modules without re-validation?
- Data flow security: does sensitive data cross module boundaries unprotected?
- Privilege escalation: can chaining operations across modules bypass access controls?
- Shared state: are shared caches, sessions, or databases accessed with consistent authorization?
- Service-to-service auth: are internal API calls authenticated and authorized?

Follow the same Output — Findings Epic instructions as module audits (title prefix: `[Security Findings]`, label: `meta:security-audit-findings`). Include Dependencies section: Blocked by #{part-audit-1}, #{part-audit-2}, ... #{part-audit-N}

Link to parent epic via `sub_issue_write`.

#### 5b. OWASP Top 10 & Compliance Alignment Audit

**Title:** `Security Audit: OWASP Top 10 & Compliance Alignment`

**Labels:** `type:security-audit`, `status:ready`, `executor:agent`, `priority:p0`, `has-dependencies`

**Body:** Scope: Map all module audit findings against the OWASP Top 10 (2025) and OWASP Top 10 for Agentic Applications (2025) and assess infrastructure/deployment security posture. This audit runs AFTER all module audits complete.

Audit areas:
- Map each module finding to the relevant OWASP Top 10 category (A01–A10) and OWASP Agentic Top 10 category (ASI01–ASI10)
- Identify OWASP categories (both traditional and agentic) with no findings — assess whether coverage is complete or audits missed them
- Infrastructure security: cloud configuration, container security, network policies
- Deployment security: CI/CD pipeline security, artifact signing, environment isolation
- Dependency security posture: cross-reference with latest dep-audit results if available
- Security testing coverage: are there automated security tests (SAST, DAST, security rules tests)?

Follow the same Output — Findings Epic instructions. Include Dependencies section: Blocked by #{part-audit-1}, #{part-audit-2}, ... #{part-audit-N}

Link to parent epic via `sub_issue_write`.

---

### Step 6: Finalize Epic & Set Dependencies

1. **Update the security audit epic body** with the actual sub-issue numbers in the Sub-Issues checklist and Implementation Order section. Use `issue_write` with `method: update`.

2. **Verify dependency sections** on the trust boundaries and OWASP sub-issues contain the correct module audit sub-issue numbers.

3. Present a summary with epic number, sub-issues, and total count.

---

### Step 7: Board Integration

All issue and epic operations in this command MUST follow the Projects v2 Enforcement rules defined in `hatch3r-board-shared`.

1. **Projects v2 Sync:** Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary) for the security audit epic and ALL sub-issues. Set status to Ready using the project's status field option ID.

2. **Board Overview Regeneration:** Regenerate the Board Overview using the **Board Overview Template** from the shared context. Use cached board data from Step 1, updated with the newly created security audit epic. Skip silently if no board overview issue exists.

---

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in the Pre-Execution Cost Preview above before the first module audit-authoring dispatch (Step 4).
- **Post-execution `cost_actuals` + `delta`** — appended to the Step 6 finalization summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 3`, which is the static floor; actual fan-out scales with discovered module count per `rules/fan-out-discipline.md` P8 B2): one `hatch3r-implementer` Task per module sub-issue body + `hatch3r-dependency-auditor` + `hatch3r-security` for the two cross-cutting axes. Tier 2 (module count ≤8) and Tier 3 (module count >8) both bound the parallel module batch by `max_phase4_parallel`. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- `search_issues` failure: retry once, then warn and proceed (assume no existing security audit).
- `issue_write` failure: report the error, retry once. If still failing, present the drafted body for manual creation.
- `sub_issue_write` failure: report but do not delete the created sub-issue. Note the unlinking for manual fix.
- Projects v2 sync failure (gh CLI or MCP): warn and continue. Board sync can be fixed later via board-refresh.

## Guardrails

- **Never skip ASK checkpoints.**
- **Use GitHub MCP tools for issue operations** (create, update, link). For Projects v2 board integration, follow the sync procedure from hatch3r-board-shared (gh CLI primary).
- **The command ONLY creates issues.** It does NOT execute any audits, run tests, or modify code.
- **Always include the `meta:security-audit` label** on the security audit epic.
- **Always include `meta:security-audit-findings`** in the output instructions for audit sub-issues.
- **Preserve dependency ordering.** Level 2 sub-issues must reference all Level 1 sub-issues in their Dependencies section.
- **Never downgrade finding severity without explicit user approval.**
- **Critical/high severity findings must always generate sub-issues.** Never suppress or skip a critical or high severity finding.
- **All findings must reference the security domain (1–8)** they belong to for traceability.
- **Board Overview is auto-maintained.** Exclude it from all analysis. One board overview issue at a time.
- **Do not expand scope.** The command creates exactly the discovered modules plus the two cross-cutting audits. No additional issue types.
