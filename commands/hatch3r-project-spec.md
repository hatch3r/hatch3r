---
id: hatch3r-project-spec
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-docs-writer]
description: Translate a greenfield vision into future-state design artifacts -- ADRs, domain model, API contracts, per-module technical specs, and a board-ready todo.md
tags: [planning, ctx:greenfield-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: deep
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 7
  rationale: Seven parallel hatch3r-researcher domains per vision brief in Step 3 — stack, features, architecture, pitfalls, UX, business-model-and-market, production-and-scale; docs-writers fan out in a second parallel batch in Step 7 (one per document category). Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

# Project Spec — Greenfield Project Specification from Vision to Docs

Take a project idea or vision and produce complete project documentation across **two dimensions**: business strategy and technical architecture. Spawns parallel researcher sub-agents (stack, features, architecture, pitfalls, UX, business model & market, production & scale) to analyze the vision from every angle before generating artifacts. Outputs business specs to `docs/specs/business/` (business model, competitive analysis, GTM strategy, production blueprint), technical specs to `docs/specs/technical/` (glossary, overview, per-module specs), ADRs to `docs/adr/`, and a `todo.md` ready for `hatch3r-board-fill`. Optionally generates a root-level `AGENTS.md` as the project's "README for agents." AI proposes all outputs; user confirms before any files are written.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (6 parallel: stack, features, architecture, pitfalls, UX, business model) | Yes | Yes |
| 2. Document Generation | `hatch3r-docs-writer` (parallel: business spec, technical spec, ADRs) | Yes | Yes |
| 3. AGENTS.md | `hatch3r-docs-writer` (AGENTS.md generation/rework) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that downstream commands like `hatch3r-board-fill` rely on. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory — do not re-invoke sub-agents.
2. **Limit documentation reads.** When reading existing project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.

---

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces spec readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. When in doubt, **ASK** — it is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.

## Step 0: Triage

Classify the project-spec request before delegating:

- **Tier 1 (trivial)**: small greenfield project with focused scope, single platform, no compliance burden; reduced fanout (3–4 researchers) and skip the production-blueprint sub-agent.
- **Tier 2 (standard)**: standard greenfield with business and technical lenses; standard pipeline with all 7 parallel researchers and ADR generation.
- **Tier 3 (deep)**: enterprise-scale, multi-platform, or regulated greenfield (HIPAA/PCI/FedRAMP); full pipeline with all researchers, deep web research for compliance, and confirm spec scope with the user before file writes.

If Tier 1, run the reduced researcher set and skip Sub-Agents 6–7 unless the user opts in. If Tier 2, run the standard pipeline below. If Tier 3, run the full pipeline including the production-blueprint and confirm scope with the user before generating ADRs.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first researcher dispatch (Step 3), surface the cost preview so a multi-researcher project-spec run is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier:

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 ~3-4, Tier 2 ~7, Tier 3 up to 7>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the iteration summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a focused greenfield scored as Deep, or a regulated multi-platform project scored as Light. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the Step 0 auto-classification stands.

---

### Step 1: Gather Project Vision & Business Context

#### 1a. Core Vision

**ASK:** "Tell me about your project. I need:
- **Project name**
- **Vision / purpose** (one paragraph — what does it do and why?)
- **Target platform(s)** (web, mobile, CLI, API, desktop, embedded, etc.)
- **Key user personas** (who uses this and what are their goals?)
- **Known constraints** (budget, timeline, team size, tech mandates, compliance, etc.)

If you have a PRD, design doc, or existing spec, share it and I'll extract these from it."

If the user provides a PRD or existing document, read it and extract the fields above.

#### 1b. Onboarding Scope Selection

**ASK:** "Should I spec the **full product**, or only **specific parts**? If specific, list the domains, modules, or feature areas to focus on."

#### 1c. Company Stage Assessment

**ASK:** "To calibrate recommendations to your situation, tell me about your company/project stage:

- **Company stage**: pre-revenue / early-revenue / growth / scale / enterprise
- **Team composition**: solo founder, small team (2-5), medium (5-20), large (20+)
- **Current user/revenue scale**: no users yet, beta (<1K), early traction (1K-50K), growth (50K-500K), scale (500K+)
- **Funding/runway**: bootstrapped, pre-seed, seed, Series A+, profitable
- **Regulatory/compliance needs**: none, basic (GDPR/SOC2), heavy (HIPAA/PCI/FedRAMP)
- **Deployment maturity**: no deployment yet, manual, CI/CD, full GitOps"

Cache the stage assessment. It drives **stage-adaptive depth** throughout the spec generation:
- **Pre-revenue / early-revenue**: MVP-focused specs. Emphasize speed-to-market, core user flows, minimal viable infrastructure. Skip enterprise features.
- **Growth**: Scaling-aware specs. Emphasize performance considerations, horizontal scaling, monitoring, technical debt prevention.
- **Scale / enterprise**: Production-hardened specs. Emphasize SLA readiness, disaster recovery, governance, audit trails, multi-region.

#### 1d. Business Discovery

**ASK:** "Now for the business context — this shapes the business specs and competitive research:

- **Business model type**: SaaS, marketplace, platform, API-first, consumer app, internal tool, open source
- **Revenue model**: subscription, transactional, freemium, advertising, enterprise licensing, or not yet decided
- **Key competitors**: name your top 3 competitors or comparable products (I will research them in depth)
- **Target market segments / ICP** (ideal customer profile): who exactly are you building for?
- **Key business metrics/KPIs**: what will you measure to know if this is working? (e.g., MRR, DAU, conversion rate, churn)
- **Go-to-market status**: pre-launch, launched, scaling
- **Regulatory or industry-specific requirements**: any compliance, certifications, or legal constraints?

Any additional business context I should know?"

#### 1e. Present Vision Summary

Present a structured summary combining all gathered context:

```
Project Vision Summary:
  Name:          {name}
  Vision:        {one-paragraph vision}
  Platforms:     {list}
  Personas:      {list with brief goals}
  Constraints:   {list}
  Scope:         {full product / specific areas}

Business Context:
  Model:         {business model type}
  Revenue:       {revenue model}
  Competitors:   {list}
  Market/ICP:    {segments}
  KPIs:          {metrics}
  GTM Status:    {status}
  Compliance:    {requirements}

Company Stage:
  Stage:         {stage}
  Team:          {size}
  Users:         {scale}
  Funding:       {status}
```

**ASK:** "Does this capture your vision and business context? Adjust anything before I send this to the research phase."

If running as part of a pipeline after `hatch3r-codebase-map`, check for `.hatch3r-session.json` and pre-fill any already-answered questions. Confirm with the user rather than re-asking.

---

### Step 2: Spawn Parallel Researcher Sub-Agents

Launch one sub-agent per research domain below concurrently using the Task tool with `subagent_type: "generalPurpose"`. Each receives the confirmed vision summary (including business context and company stage) from Step 1 and produces structured markdown output.

**All sub-agent prompts must include:**
- The full confirmed project vision summary, business context, and company stage
- Instruction to use Context7 MCP (`resolve-library-id` then `query-docs`) for any library or framework documentation
- Instruction to use **web search** for current best practices, security advisories, ecosystem trends, competitor research, and market data
- Instruction to output in structured markdown with clear headers and tables
- Explicit instruction: **do NOT create any files — return output as a structured result**

#### Sub-Agent 1: Stack Researcher

**Prompt context:** Analyze the project requirements, company stage, and business model to recommend a complete technology stack calibrated to the stage.

**Output structure:**

```markdown
## Stack Recommendation

### Languages & Frameworks
| Layer | Recommendation | Alternatives | Trade-offs |
|-------|---------------|--------------|------------|
| {layer} | {pick} | {alt1}, {alt2} | {why this over alternatives} |

### Data Layer
| Component | Recommendation | Alternatives | Trade-offs |
|-----------|---------------|--------------|------------|
| {component} | {pick} | {alt1}, {alt2} | {rationale} |

### Infrastructure & DevOps
| Component | Recommendation | Alternatives | Trade-offs |
|-----------|---------------|--------------|------------|
| Hosting | {pick} | ... | ... |
| CI/CD | {pick} | ... | ... |
| Monitoring | {pick} | ... | ... |

### Key Dependencies
- {package}: {version} — {purpose}
- ...

### Stack Rationale
{2-3 paragraph justification tying choices back to project constraints, company stage, and personas}
```

#### Sub-Agent 2: Feature Researcher

**Prompt context:** Break the vision into features organized by domain/module. Consider the business model and revenue priorities when suggesting priority ordering.

**Output structure:**

```markdown
## Feature Catalog

### Module: {module-name}
| # | Feature | User Story | Acceptance Criteria | Complexity | Dependencies |
|---|---------|-----------|---------------------|------------|--------------|
| 1 | {title} | As a {persona}, I want {goal} so that {benefit} | - [ ] {criterion} | S/M/L/XL | {deps} |

### Module: {module-name}
...

### Feature Summary
| Module | Feature Count | Avg Complexity | Key Dependencies |
|--------|--------------|----------------|------------------|
| {name} | {N} | {S/M/L/XL} | {list} |

### Suggested Priority Ordering
## P0 — Critical / Launch Blockers
- {feature}: {reason}

## P1 — Core Features
- {feature}: {reason}

## P2 — Important
- {feature}: {reason}

## P3 — Nice to Have
- {feature}: {reason}
```

#### Sub-Agent 3: Architecture Researcher

**Prompt context:** Design the system architecture based on the vision, constraints, and company stage. Use web search for architecture patterns proven at similar scale.

**Output structure:**

```markdown
## Architecture Overview

### System Components
| Component | Responsibility | Tech | Communicates With |
|-----------|---------------|------|-------------------|
| {name} | {what it does} | {stack} | {list} |

### Data Flow
{Description of primary data flows between components}

### Integration Points
| Integration | Protocol | Auth | Notes |
|-------------|----------|------|-------|
| {name} | REST/gRPC/WS/etc. | {method} | {constraints} |

### Deployment Topology
{Description of deployment architecture — serverless, containers, monolith, etc.}

### Architectural Decisions Requiring ADRs
| # | Decision | Context | Recommended | Alternatives |
|---|----------|---------|-------------|--------------|
| 1 | {title} | {why this decision matters} | {pick} | {alt1}, {alt2} |
```

#### Sub-Agent 4: Pitfalls Researcher

**Prompt context:** Identify risks, anti-patterns, and common mistakes for this project domain, chosen platform(s), and company stage. Include both technical and business risks.

**Output structure:**

```markdown
## Risk Register

### Technical Risks
| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | {risk} | High/Med/Low | High/Med/Low | {strategy} |

### Business Risks
| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | {risk} | High/Med/Low | High/Med/Low | {strategy} |

### Security Concerns
| # | Concern | Severity | Mitigation |
|---|---------|----------|------------|
| 1 | {concern} | Critical/High/Med/Low | {strategy} |

### Anti-Patterns to Avoid
- **{pattern}**: {why it's tempting} → {what to do instead}

### Scalability Bottlenecks
| # | Bottleneck | When It Hits | Mitigation |
|---|-----------|-------------|------------|
| 1 | {bottleneck} | {threshold/condition} | {strategy} |

### Domain-Specific Pitfalls
- {pitfall}: {explanation and mitigation}

### Recommended Best Practices
- {practice}: {rationale}
```

#### Sub-Agent 5: UX Researcher

**Prompt context:** Analyze the project from a user experience perspective — user journeys, interaction patterns, accessibility, responsive strategy, and visual design direction. Research competitor UX using web search.

**Output structure:**

```markdown
## UX Research: {project_name}

### User Personas
| Persona | Technical Sophistication | Accessibility Needs | Primary Goals |
|---------|------------------------|---------------------|---------------|
| {persona} | {level} | {needs} | {goals} |

### User Journeys
| Journey | Steps | Touchpoints | Pain Points | Success Criteria |
|---------|-------|-------------|-------------|------------------|
| {journey} | {step flow} | {touchpoints} | {pain points} | {criteria} |

### Interaction Patterns
| Pattern | Navigation Model | Information Architecture | Key Interactions |
|---------|-----------------|------------------------|------------------|
| {pattern} | {model} | {IA approach} | {interactions} |

### Accessibility Requirements
| Requirement | WCAG Level | Assistive Tech Impact | Implementation Notes |
|-------------|-----------|----------------------|---------------------|
| {requirement} | AA/AAA | {impact} | {notes} |

- Reduced motion preferences and prefers-color-scheme support
- Keyboard navigation requirements
- Screen reader landmark and ARIA strategy

### Responsive Strategy
| Breakpoint | Target Devices | Approach | Layout Changes |
|-----------|---------------|----------|----------------|
| {breakpoint} | {devices} | {mobile-first/desktop-first} | {changes} |

- Touch vs pointer interaction differences
- Viewport-specific feature adjustments

### Visual Design Direction
| Aspect | Recommendation | Rationale |
|--------|---------------|-----------|
| Design System | {evaluation} | {why} |
| Component Library | {assessment} | {why} |
| Theming | {approach} | {why} |

### Competitive UX Analysis
| Competitor | UX Strengths | UX Weaknesses | Opportunities |
|-----------|-------------|---------------|---------------|
| {competitor} | {strengths} | {weaknesses} | {opportunities} |

### UX Risks & Recommendations
| # | Risk | Likelihood | Impact | Recommendation |
|---|------|-----------|--------|----------------|
| 1 | {risk} | High/Med/Low | High/Med/Low | {recommendation} |
```

#### Sub-Agent 6: Business Model & Market Researcher

**Prompt context:** Full vision summary, business context, company stage, and competitor names from Step 1d.

**Task:** Validate and expand the business model using **deep web research**. This sub-agent MUST use web search extensively — search for each named competitor, research market reports, and find relevant benchmarks.

1. **Competitive landscape**: Research each named competitor:
   - Features and product positioning
   - Pricing tiers and packaging
   - Target market and ICP
   - Tech stack (if publicly known)
   - Strengths, weaknesses, and market gaps
2. **Market analysis**:
   - TAM/SAM/SOM estimation for the target market
   - Market trends and timing (is this market growing, saturating, or emerging?)
   - Key market dynamics (winner-take-all, fragmented, regulated, etc.)
3. **Business model validation**:
   - Compare chosen business model against successful products in the same space
   - Identify business model risks (market fit, pricing sensitivity, switching costs)
   - Benchmark monetization metrics (conversion rates, ARPU, churn) for similar models
4. **Go-to-market patterns**:
   - What acquisition channels work for similar products (PLG, sales-led, content, partnerships)
   - Launch strategy recommendations for the company stage
   - Early traction playbook (first 100 users, first 1000 users)
5. **Monetization benchmarks**:
   - Pricing tier analysis based on competitor research
   - Free vs paid feature split recommendations
   - Revenue projections at key milestones
6. **Regulatory landscape**:
   - Industry-specific compliance requirements
   - Data privacy regulations by target geography
   - Certification requirements (SOC2, HIPAA, PCI, etc.)

**Output structure:**

```markdown
## Competitive Analysis

### Competitor: {name}
- **URL**: {url}
- **Positioning**: {how they position themselves}
- **Features**: {key features}
- **Pricing**: {pricing tiers}
- **Target Market**: {who they sell to}
- **Tech Stack**: {if known}
- **Strengths**: {list}
- **Weaknesses**: {list}
- **Market Gap**: {opportunities they miss}

(repeat for each competitor)

### Competitive Matrix
| Capability | {project} | {competitor1} | {competitor2} | {competitor3} |
|-----------|-----------|---------------|---------------|---------------|
| {feature} | {planned/yes/no} | {yes/no} | {yes/no} | {yes/no} |

### Differentiation Strategy
{How this project should differentiate — 2-3 paragraphs}

## Market Overview

### Market Size
- **TAM**: {estimate with sources}
- **SAM**: {estimate}
- **SOM**: {realistic initial target}

### Market Trends
- {trend}: {impact on this project}

### Market Dynamics
{Winner-take-all vs fragmented, regulatory environment, switching costs}

## Business Model Assessment

### Model Validation
{How similar models perform in this market — with data}

### Monetization Benchmarks
| Metric | Industry Average | Top Quartile | Target |
|--------|-----------------|-------------|--------|
| Conversion (free→paid) | {%} | {%} | {%} |
| Monthly churn | {%} | {%} | {%} |
| ARPU | {$} | {$} | {$} |
| LTV | {$} | {$} | {$} |

### Pricing Strategy Recommendation
{Recommended pricing tiers with rationale}

## GTM Recommendations

### Recommended Channels
| Channel | Fit | Stage | Expected CAC | Notes |
|---------|-----|-------|-------------|-------|
| {channel} | high/med/low | {when to start} | {estimate} | {notes} |

### Launch Playbook
{Stage-appropriate launch strategy — MVP launch for pre-revenue, growth tactics for growth stage}

## Regulatory Landscape
| Regulation | Applies | Impact | Timeline |
|-----------|---------|--------|----------|
| {regulation} | yes/likely/no | {impact on product} | {when to address} |
```

#### Sub-Agent 7: Production & Scale Researcher

**Prompt context:** Full vision summary, business context, company stage, and stack researcher output (if available via sequential dependency — otherwise use the vision's platform targets).

**Task:** Design infrastructure calibrated to the company maturity tier per CONSTITUTION §6 Decision 4 (solo / team / scaleup / enterprise). Use **web search** for cloud provider pricing, infrastructure patterns for the chosen stack, and SLA benchmarks for the industry.

1. **Infrastructure architecture**:
   - Hosting recommendation (cloud provider, serverless, containers, edge)
   - CDN and static asset strategy
   - Multi-region strategy (if applicable for stage)
   - Environment management (dev, staging, prod)
2. **Scaling strategy**:
   - Database scaling plan (connection pooling → read replicas → sharding)
   - Caching strategy (application cache, CDN, browser, edge)
   - Async processing (background jobs, queues, event-driven)
   - Rate limiting and throttling
3. **Observability design**:
   - Logging strategy (structured logging, log aggregation)
   - Metrics to track (application, infrastructure, business)
   - Distributed tracing (OpenTelemetry, vendor-specific)
   - Alerting thresholds and escalation
4. **Reliability design**:
   - SLA targets appropriate for stage
   - Error budgets and SLO definitions
   - Circuit breaker patterns and graceful degradation
   - Health check strategy
5. **Security baseline**:
   - Auth architecture (sessions, JWT, OAuth providers)
   - Secrets management strategy
   - Vulnerability scanning pipeline
   - SBOM generation
6. **Cost modeling**:
   - Estimated infrastructure cost at key user milestones (1K, 10K, 100K, 1M users)
   - Cost optimization strategies for the stage
   - Break-even analysis (infra cost vs revenue per user)
7. **DevOps pipeline**:
   - CI/CD design (build, test, deploy stages)
   - Environment strategy (preview environments, staging, canary)
   - Feature flag infrastructure
   - Rollback strategy

**Output structure:**

```markdown
## Infrastructure Blueprint

### Hosting & Compute
| Component | Recommendation | Alternative | Monthly Cost (est.) |
|-----------|---------------|-------------|-------------------|
| {component} | {pick} | {alt} | {cost} |

### Environment Strategy
| Environment | Purpose | Infra | Access |
|------------|---------|-------|--------|
| Development | {purpose} | {setup} | {who} |
| Staging | {purpose} | {setup} | {who} |
| Production | {purpose} | {setup} | {who} |

## Scaling Playbook

### Phase 1: MVP (0-1K users)
{Minimal viable infrastructure — what to set up now}

### Phase 2: Traction (1K-50K users)
{What to add as you grow — caching, CDN, background jobs}

### Phase 3: Growth (50K-500K users)
{Horizontal scaling, read replicas, queue-based processing}

### Phase 4: Scale (500K+ users)
{Multi-region, sharding, edge computing, dedicated infrastructure}

## Observability Strategy

### Logging
- Tool: {recommendation}
- Strategy: {structured logging approach}

### Metrics
| Category | Metrics | Tool |
|----------|---------|------|
| Application | {list} | {tool} |
| Infrastructure | {list} | {tool} |
| Business | {list} | {tool} |

### Alerting
| Alert | Threshold | Severity | Escalation |
|-------|-----------|----------|------------|
| {alert} | {threshold} | {level} | {action} |

## Reliability Design
- SLA Target: {target for stage}
- Error Budget: {budget}
- Recovery Time Objective: {RTO}
- Recovery Point Objective: {RPO}

## Security Baseline
| Area | Recommendation | Priority |
|------|---------------|----------|
| Authentication | {approach} | P0 |
| Secrets | {management} | P0 |
| Scanning | {pipeline} | P1 |

## Cost Model

| Users | Compute | Database | Storage | CDN | Monitoring | Total/mo |
|-------|---------|----------|---------|-----|-----------|----------|
| 1K | {$} | {$} | {$} | {$} | {$} | {$} |
| 10K | {$} | {$} | {$} | {$} | {$} | {$} |
| 100K | {$} | {$} | {$} | {$} | {$} | {$} |
| 1M | {$} | {$} | {$} | {$} | {$} | {$} |

## DevOps Pipeline
- CI/CD: {tool and stages}
- Preview Environments: {strategy}
- Feature Flags: {tool}
- Rollback: {strategy}
```

Wait for all sub-agents to complete before proceeding.

---

### Step 3: Review Researcher Outputs

1. Present a **merged summary** combining key findings from all researchers:

```
Research Summary:

— Technical —
Stack:         {primary stack in one line}
Modules:       {N} modules, {M} total features
Components:    {N} architectural components
ADRs:          {N} architectural decisions identified
Risks:         {N} technical risks ({X} high, {Y} med, {Z} low)
UX:            {N} personas, {M} user journeys, {accessibility level}

— Business —
Competitors:   {N} researched
Market Size:   TAM {$}, SAM {$}, SOM {$}
Model:         {business model} — {revenue model}
GTM:           {recommended primary channel}
Pricing:       {recommended strategy}
Regulatory:    {N} applicable regulations

— Production —
Infra Cost:    ~{$}/mo at launch, ~{$}/mo at {target} users
Scale Plan:    {N} phases identified
SLA Target:    {target for stage}
Top Gaps:      {list of missing infrastructure}
```

2. **Highlight conflicts** between researchers. Common conflict types:
   - Stack researcher recommends framework X but architecture researcher assumes framework Y
   - Feature researcher scopes a module that the pitfalls researcher flags as an anti-pattern
   - Architecture decisions that contradict known constraints
   - UX researcher's accessibility or responsive requirements conflict with stack or architecture choices
   - UX researcher's interaction patterns conflict with feature researcher's flow assumptions
   - Business model researcher's pricing strategy conflicts with feature researcher's free/paid split
   - Production researcher's infrastructure cost exceeds business model researcher's revenue projections
   - Pitfalls researcher's business risks conflict with GTM recommendations

3. For each conflict, present both sides and a recommended resolution.

**ASK:** "Here is the merged research summary with business, technical, and production dimensions. Conflicts (if any) are highlighted above. Options:
- **Confirm** to proceed with spec generation
- **Adjust** specific findings (tell me what to change)
- **Re-run** a specific researcher with updated parameters
- **Add context** — I have additional information that changes things"

---

### Step 4: Generate Specs (Dual-Lens)

From the merged researcher outputs, generate spec documents in **two separate directories**: business specs and technical specs. Present all content for review before writing any files.

#### 4a. Technical Specs — `docs/specs/technical/`

##### Technical Glossary — `docs/specs/technical/00_glossary.md`

```markdown
# Technical Glossary

> Stable IDs for all entities, events, and modules in {project-name}.
> All specs reference items by their stable ID.

## Entities

| Stable ID | Name | Description |
|-----------|------|-------------|
| {entity-id} | {Name} | {description} |

## Events

| Stable ID | Name | Trigger | Description |
|-----------|------|---------|-------------|
| {event-id} | {Name} | {trigger} | {description} |

## Modules

| Stable ID | Name | Description | Primary Spec |
|-----------|------|-------------|--------------|
| {module-id} | {Name} | {description} | {spec-file} |
```

Derive entities, events, and modules from the feature researcher and architecture researcher outputs. Assign stable IDs using a consistent scheme (e.g., `USR`, `ORD`, `EVT_USER_CREATED`, `MOD_AUTH`).

##### Technical Overview — `docs/specs/technical/01_overview.md`

```markdown
# {Project Name} — Technical Overview

## Purpose

{Vision paragraph from Step 1}

## Scope

### In Scope
- {item}

### Out of Scope
- {item}

## Personas

| Persona | Goals | Key Flows |
|---------|-------|-----------|
| {name} | {goals} | {flows} |

## Constraints

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| {constraint} | {impact} | {mitigation} |

## Technology Stack

{Summary from stack researcher — languages, frameworks, databases, hosting}

## Architecture Summary

{Summary from architecture researcher — components, topology}

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

##### Module Specs — `docs/specs/technical/02_{module-slug}.md` (one per module)

For each module discovered by the feature researcher:

```markdown
# {Module Name}

## Purpose

{What this module does and why it exists}

## Requirements

| Req ID | Requirement | Priority | Source |
|--------|-------------|----------|--------|
| {module-id}-R01 | {requirement} | P0/P1/P2/P3 | {feature/persona} |

## Features

| Feature | User Story | Acceptance Criteria | Complexity |
|---------|-----------|---------------------|------------|
| {title} | {story} | {criteria as checklist} | S/M/L/XL |

## Dependencies

| Depends On | Type | Notes |
|-----------|------|-------|
| {module-id} | hard/soft | {notes} |

## Edge Cases

- {edge case}: {expected behavior}

## Invariants

| Invariant | Enforcement |
|-----------|-------------|
| {rule} | {how enforced} |

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

Number module specs sequentially: `02_`, `03_`, `04_`, etc. Use slugified module names (lowercase, hyphens).

#### 4b. Business Specs — `docs/specs/business/`

##### Business Glossary — `docs/specs/business/00_business_glossary.md`

```markdown
# Business Glossary

> Stable IDs for all business entities, domain terms, and events in {project-name}.
> Cross-references technical glossary IDs where business entities map to code.

## Business Entities

| Stable ID | Name | Description | Technical ID |
|-----------|------|-------------|-------------|
| {biz-id} | {Name} | {business definition} | {technical glossary ID} |

## Business Events

| Stable ID | Name | Trigger | Business Impact |
|-----------|------|---------|----------------|
| {evt-id} | {Name} | {trigger} | {impact} |

## Domain Terms

| Term | Definition | Context |
|------|-----------|---------|
| {term} | {definition} | {where used} |

## Business Metrics

| Metric ID | Name | Definition | Target |
|-----------|------|-----------|--------|
| {metric-id} | {Name} | {how calculated} | {target value} |
```

##### Business Overview — `docs/specs/business/01_business_overview.md`

```markdown
# {Project Name} — Business Overview

## Vision & Value Proposition

{Vision paragraph — what problem does this solve and for whom?}

## Business Model

- **Type**: {SaaS / marketplace / platform / etc.}
- **Revenue Model**: {subscription / transactional / freemium / etc.}
- **Pricing Strategy**: {from Business Model Researcher}

## Market Context

### Target Market
- **ICP**: {ideal customer profile}
- **Market segments**: {segments}
- **TAM/SAM/SOM**: {from Business Model Researcher}

### Market Dynamics
{Market trends, timing, competitive landscape summary}

## Personas & User Segments

| Persona | Segment | Primary Goals | Revenue Relevance |
|---------|---------|---------------|-------------------|
| {name} | {segment} | {goals} | {how they contribute to revenue} |

## Key Business Metrics

| Metric | Definition | Target | Tracking Status |
|--------|-----------|--------|----------------|
| {metric} | {definition} | {target} | {planned / to be implemented} |

## Company Stage Context

- **Stage**: {stage}
- **Team**: {composition}
- **Users**: {scale}
- **Funding**: {status}
- **Compliance**: {requirements}

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

##### Business Domain Specs — `docs/specs/business/02_{domain-slug}.md` (one per business domain)

For each business domain identified from the feature catalog:

```markdown
# {Business Domain Name}

## Domain Overview

{What this business domain covers and why it matters}

## Business Rules

| # | Rule | Enforcement | Priority | Revenue Impact |
| - | ---- | ----------- | -------- | -------------- |
| 1 | {rule} | {how enforced} | P0/P1/P2/P3 | {impact} |

## User Journeys

| Journey | Persona | Steps | Success Criteria | KPIs |
|---------|---------|-------|-----------------|------|
| {name} | {persona} | {steps} | {criteria} | {metrics} |

## Domain Invariants

| Invariant | Enforcement | Business Impact if Violated |
|-----------|-------------|-----------------------------|
| {rule} | {how enforced} | {impact} |

## Revenue Relevance

{How this domain relates to revenue — monetization touchpoints, conversion impact, retention impact}

---

**Owner / Reviewers / Last updated**
Owner: {tbd}
Reviewers: {tbd}
Last updated: {today's date}
```

##### Competitive Analysis — `docs/specs/business/03_competitive_analysis.md`

Full competitive analysis from Sub-Agent 6, formatted as a standalone spec document.

##### GTM Strategy — `docs/specs/business/04_gtm_strategy.md`

Go-to-market strategy and launch playbook from Sub-Agent 6, formatted as a standalone spec document.

##### Production Blueprint — `docs/specs/business/05_production_blueprint.md`

Full infrastructure blueprint, scaling playbook, observability strategy, and cost model from Sub-Agent 7, formatted as a standalone spec document with business-impact framing.

#### 4c. Present for Review

Present the list of specs to be generated with a brief summary of each, organized by business and technical.

**ASK:** "Here are the generated specs across both business and technical dimensions. Review the content before I write the files:

**Technical specs** (`docs/specs/technical/`):
- `00_glossary.md` — {entity count} entities, {event count} events, {module count} modules
- `01_overview.md` — technical overview
- {list of module specs}

**Business specs** (`docs/specs/business/`):
- `00_business_glossary.md` — {N} business entities, {N} metrics
- `01_business_overview.md` — business model, market context, personas
- {list of domain specs}
- `03_competitive_analysis.md` — {N} competitors analyzed
- `04_gtm_strategy.md` — go-to-market plan
- `05_production_blueprint.md` — infrastructure & cost model

Confirm, or tell me what to adjust."

---

### Step 5: Generate ADRs

From the architecture researcher's "Architectural Decisions Requiring ADRs" output and the business model researcher's strategic decisions, create one ADR per decision. Include both technical and business-driven decisions.

#### ADR Format — `docs/adr/0001_{decision-slug}.md`

```markdown
# ADR-{NNNN}: {Decision Title}

## Status

Proposed

## Date

{today's date}

## Scope

{Technical / Business / Both}

## Decision Makers

{tbd}

## Context

{Why this decision is needed — business and technical context}

## Decision

{What was decided and why}

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| {option} | {pros} | {cons} | {reason} |

## Consequences

### Positive
- {consequence}

### Negative
- {consequence}

### Risks
- {risk}: {mitigation}
```

Number ADRs sequentially: `0001_`, `0002_`, etc. Use slugified decision titles.

**ASK:** "Here are {N} ADRs generated from architectural and business decisions (scope marked as Technical/Business/Both). Review before I write the files:
{list with titles and scopes}

Confirm, or tell me what to adjust."

---

### Step 6: Generate Initial todo.md

From the feature researcher's priority ordering, the business model researcher's GTM requirements, and the production researcher's infrastructure needs, create a `todo.md` at the project root in the format that `hatch3r-board-fill` expects. Tag each item with `[BIZ]`, `[TECH]`, or `[BOTH]`.

```markdown
## P0 — Critical / Launch Blockers

- [ ] **[TECH] {Infrastructure item}**: {Description}. Ref: docs/specs/technical/{spec}.md.
- [ ] **[BIZ] {Market-driven item}**: {Description}. Ref: docs/specs/business/{spec}.md.
- [ ] **[BOTH] {Cross-cutting item}**: {Description}. Ref: docs/specs/{spec}.md.

## P1 — Core Features

- [ ] **[TECH] {Feature title}**: {Description}. Ref: docs/specs/technical/{spec}.md.
- [ ] **[BIZ] {Business feature}**: {Description}. Ref: docs/specs/business/{spec}.md.

## P2 — Important

- [ ] **[TECH] {Improvement}**: {Description}. Ref: docs/specs/technical/{spec}.md.
- [ ] **[BIZ] {Business requirement}**: {Description}. Ref: docs/specs/business/{spec}.md.

## P3 — Nice to Have

- [ ] **[TECH] {Enhancement}**: {Description}.
- [ ] **[BIZ] {Business enhancement}**: {Description}.
```

Each item:
- Uses markdown checklist syntax (`- [ ]`)
- Has a **`[BIZ]`/`[TECH]`/`[BOTH]` tag** followed by **bold title** and description
- References its source spec file (business or technical)
- Is scoped at epic level (board-fill will break items into sub-issues)

Include items from:
- Feature researcher's priority ordering
- Pitfalls researcher's risk register as P0/P1 items where appropriate
- Business model researcher's GTM requirements (e.g., analytics setup, payment integration)
- Production researcher's infrastructure needs (e.g., CI/CD setup, monitoring)

**ASK:** "Here is the initial todo.md with {N} items across priorities ({N} BIZ, {N} TECH, {N} BOTH). Review before I write the file.

Confirm, or tell me what to adjust."

---

### Step 7: Write All Files

Spawn parallel `hatch3r-docs-writer` sub-agents via the Task tool (`subagent_type: "generalPurpose"`) to generate and write the documentation. Each docs-writer receives the confirmed researcher outputs from Steps 3-6 and is responsible for one document category. All docs-writers run in parallel and follow the `hatch3r-docs-writer` agent protocol.

| Docs-Writer | Responsibility | Input |
|-------------|---------------|-------|
| Business Spec Writer | `docs/specs/business/` (glossary, overview, domain specs, competitive analysis, GTM strategy, production blueprint) | Sub-Agent 6 (Business Model & Market) and Sub-Agent 7 (Production & Scale) outputs, business context from Step 1 |
| Technical Spec Writer | `docs/specs/technical/` (glossary, overview, module specs) | Sub-Agent 1 (Stack), Sub-Agent 2 (Feature), Sub-Agent 3 (Architecture) outputs |
| ADR Writer | `docs/adr/` (all architectural decision records) | Architecture decisions from Step 5, business-driven decisions from Sub-Agent 6 |

Each docs-writer prompt must include:
- The full confirmed researcher output relevant to its document category
- The confirmed project vision, company stage, and business context from Step 1
- The directory structure and file naming conventions below
- Instruction to follow the `hatch3r-docs-writer` agent protocol
- Instruction to create directories before writing files if they do not exist

After all docs-writers complete, the orchestrator handles the remaining files (todo.md, .hatch3r-session.json) and presents the summary.

The docs-writers follow this file structure:

1. Create `docs/specs/technical/` directory and write all technical spec files:
   - `docs/specs/technical/00_glossary.md`
   - `docs/specs/technical/01_overview.md`
   - `docs/specs/technical/02_{module}.md` (one per module)

2. Create `docs/specs/business/` directory and write all business spec files:
   - `docs/specs/business/00_business_glossary.md`
   - `docs/specs/business/01_business_overview.md`
   - `docs/specs/business/02_{domain}.md` (one per domain)
   - `docs/specs/business/03_competitive_analysis.md`
   - `docs/specs/business/04_gtm_strategy.md`
   - `docs/specs/business/05_production_blueprint.md`

3. Create `docs/adr/` directory and write all ADR files:
   - `docs/adr/0001_{decision}.md` (one per decision)

4. Write `todo.md` at the project root.

5. Write `.hatch3r-session.json` to the project root with the company stage assessment and business context gathered in Step 1. This allows subsequent hatch3r commands (`hatch3r-roadmap`) to skip re-asking the same discovery questions.

```json
{
  "timestamp": "{ISO timestamp}",
  "command": "hatch3r-project-spec",
  "companyStage": { ... },
  "businessContext": { ... },
  "scope": "{full / specific parts}"
}
```

6. Present a summary of all files created:

```
Files Created:
  docs/specs/technical/
    00_glossary.md          — {entity count} entities, {event count} events
    01_overview.md          — technical overview
    02_{module}.md          — {module name}
    ...
  docs/specs/business/
    00_business_glossary.md — {entity count} business entities
    01_business_overview.md — business model & market context
    02_{domain}.md          — {domain name}
    ...
    03_competitive_analysis.md — {N} competitors
    04_gtm_strategy.md      — go-to-market plan
    05_production_blueprint.md — infrastructure & cost model
  docs/adr/
    0001_{decision}.md      — {decision title}
    ...
  todo.md                   — {item count} items ({BIZ}×BIZ, {TECH}×TECH, {BOTH}×BOTH)
  .hatch3r-session.json     — session context for downstream commands
```

---

### Step 8 — AGENTS.md (Mandatory)

This step is MANDATORY, not optional.

**If `AGENTS.md` exists at project root:**

**ASK:** "Your existing AGENTS.md may be outdated after generating new documentation. Would you like to rework it based on the new specs?"

- If **yes**: spawn a `hatch3r-docs-writer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) to regenerate AGENTS.md incorporating the newly generated specs, architecture overview, module map, and conventions. The docs-writer follows the `hatch3r-docs-writer` agent protocol.
- If **no**: keep existing AGENTS.md unchanged. Log that the user declined the update.

**If no `AGENTS.md` exists:**

Generate AGENTS.md — there is no opt-out. Spawn a `hatch3r-docs-writer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) to create AGENTS.md following the `hatch3r-docs-writer` agent protocol. The docs-writer receives the confirmed researcher outputs and generates AGENTS.md with:
- Project purpose and business context
- Tech stack and architecture overview
- Module map with responsibilities
- Development conventions and patterns
- Key specs and ADR references

The generated `AGENTS.md` should follow this structure:

```markdown
# {Project Name} — Agent Instructions

> Auto-generated by hatch3r-project-spec on {today's date}. Review and adjust before use.

## Project Purpose

{One-paragraph vision/purpose from business overview}

## Business Context

- **Business model**: {type}
- **Revenue model**: {model}
- **Company stage**: {stage}
- **Target market**: {segments}
- **Key metrics**: {KPIs}

## Technology Stack

{Concise stack summary — languages, frameworks, databases, infrastructure}

## Architecture Overview

{Architecture style, key components, deployment topology — 3-5 sentences}

## Module Map

| Module | Purpose |
| ------ | ------- |
| {module} | {one-line description} |

## Key Business Rules & Domain Constraints

{Top 5-10 business rules that agents must respect when making changes}

- {rule}: {constraint}

## Conventions

{Key coding conventions agents should follow — naming, patterns, testing}

## Documentation Reference

- Business specs: `docs/specs/business/`
- Technical specs: `docs/specs/technical/`
- Architecture decisions: `docs/adr/`
```

---

### Step 9: Cross-Command Handoff

**ASK:** "Specs complete. Recommended next steps:
- Run `hatch3r-roadmap` to generate a phased roadmap from these specs
- Run `hatch3r-board-fill` to create GitHub issues from the todo.md

Which would you like to run next? (or none)"

---

## Resumability (Decision 27/30)

project-spec is long-running — a Tier 3 enterprise-scale greenfield fans out seven parallel hatch3r-researcher domains in Step 3 (stack, features, architecture, pitfalls, UX, business-model-and-market, production-and-scale), then runs a second parallel batch of docs-writers in Step 7 (one per document category: business spec, technical spec, ADRs) plus an AGENTS.md generation pass. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-running the seven-researcher + docs-writer-batch fan-out.

**Checkpoint contract** (`src/pipeline/checkpoint.ts`):

1. **Workspace + file:** write `.project-spec-workspace/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (the Step 0 → Step 9 progression), `wave` (researcher-batch index across the 7 parallel domains, then docs-writer-batch index), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, projectName, projectVision }`.
2. **Write points:** after Step 1 project-vision context locks, after Step 2 scope ASK, after the Step 3 seven-researcher fan-out returns (all domains complete), after Step 4 synthesis confirmed by ASK, after each Step 5 file write under `docs/specs/business/` and `docs/specs/technical/`, after Step 6 ADR generation, after the Step 7 docs-writer batch returns, after Step 8 AGENTS.md generation, and after Step 9 todo.md entry generation.
3. **`--resume` invocation:** `hatch3r-project-spec --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (the repo / `docs/specs/` / `docs/adr/` / `AGENTS.md` / `todo.md` changed since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline. A `failed` status halts for operator triage before resuming.
4. **Snapshot rollback:** pre-mutation snapshots of `docs/specs/business/`, `docs/specs/technical/`, `docs/adr/`, `AGENTS.md`, and `todo.md` land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's writes. Diff preview precedes every file write per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for project-spec: `1` = product intake + persona detection, `2` = spec sub-agent dispatch (vision / personas / scope / data-model / architecture), `3` = synthesis + cross-spec consistency check, `4` = spec write + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (vision doc, persona files, scope spec, architecture spec) at Tier 2 or Tier 3 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by each spawned sub-agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path>: via <hatch3r-agent-name> (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output. The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

The 9 sections:

1. **Request** — verbatim restatement of the user's ask in one sentence.
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` plus the `cost_estimate` / `cost_actuals` / `delta` blocks (see Cost Visibility below).
3. **Web Research** — every URL fetched with access date + trust tier per `agents/shared/rigor-contract.md` (0 acceptable when no research was needed).
4. **Files Mutated** — list with diff summary (lines added / removed / files created).
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist.
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per CONSTITUTION §6 Decision 17.
7. **Verification Commands** — exact commands run with exit codes plus key output lines (≤200 chars).
8. **Open Questions / Blockers** — explicit `None` if fully closed.
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run per `rules/hatch3r-learning-system.md`.

### Cost Visibility (Decision 24)

Pre-execution: emit `cost_estimate` before the first sub-agent dispatch via `src/pipeline/observability.ts::buildCostBlock` (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  triage_tier: light | standard | deep
  estimated_web_research_queries: <int>      # 0 when no research is needed
  estimated_duration_min: <int>
```

Post-execution: call `buildCostBlock` again with actuals to emit `cost_actuals` + `delta`; both land in Section 2 above. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first researcher dispatch.
- **Post-execution `cost_actuals` + `delta`** — appended to the iteration summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 7` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 3-4 (reduced researcher set, no production-blueprint); Tier 2/3 spawn up to 7 parallel researchers plus the production-blueprint sub-agent. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, present partial results from the remaining sub-agents and ask the user how to proceed (continue without that researcher's input / provide the missing information manually / abort).
- **Conflicting researcher outputs:** Present both options side by side with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide the full file content so the user can create the file manually.
- **Missing project context:** If no `hatch3r-board-shared` or `.hatch3r/hatch.json` exists, proceed without board context — this command does not require board configuration.
- **Business context gaps:** If the user cannot answer business discovery questions, proceed with "TBD" markers and flag these as open items in the business specs.
- **Stage assessment unclear:** Default to "early-revenue" if the user is unsure. This provides balanced analysis depth without over- or under-engineering recommendations.
- **Competitor research gaps:** If web search returns insufficient data for a competitor, note it as "limited public information" and present what was found.

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **When in doubt, ASK.** It is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.
- **Never write files without user review and confirmation.** All generated content is presented first.
- **Always use Context7 MCP** (`resolve-library-id` then `query-docs`) for external library and framework documentation in sub-agent prompts.
- **Always use web search** in business model and production researcher sub-agents. These sub-agents MUST research externally — do not rely solely on training data.
- **Stay within the project scope** defined by the user in Step 1. Do not invent features or modules the user did not describe or imply.
- **Specs must use stable IDs from the glossaries.** Generate glossaries first, then reference their IDs in all subsequent specs. Business and technical glossaries must cross-reference each other.
- **todo.md must be compatible with board-fill format** — markdown checklist with bold titles, grouped by priority, referencing source specs, tagged with `[BIZ]`/`[TECH]`/`[BOTH]`.
- **Do not over-specify.** Keep specs at the right level of detail for the project's stage. Avoid implementation details that belong in code, not documentation.
- **Stage-adaptive recommendations.** Never recommend enterprise-tier (per CONSTITUTION §6 Decision 4) solutions for solo-tier pre-revenue startups. Never recommend MVP shortcuts for scaleup-tier or enterprise-tier companies. Calibrate all recommendations to the company stage from Step 1c.
- **All 7 researchers must complete before proceeding to Step 3.** Do not generate specs from partial research.
- **Sub-agents must not create files.** They return structured text results to the orchestrator. Only the orchestrator writes files in Step 7.
- **Never overwrite `AGENTS.md`** without explicit user confirmation.
