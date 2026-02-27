---
id: hatch3r-project-spec
type: command
description: Generate complete business and technical project documentation (specs, ADRs, todo.md) from a project vision using parallel researcher sub-agents with dual business/technical scoping.
---
# Project Spec — Greenfield Project Specification from Vision to Docs

Take a project idea or vision and produce complete project documentation across **two dimensions**: business strategy and technical architecture. Spawns parallel researcher sub-agents (stack, features, architecture, pitfalls, UX, business model & market, production & scale) to analyze the vision from every angle before generating artifacts. Outputs business specs to `docs/specs/business/` (business model, competitive analysis, GTM strategy, production blueprint), technical specs to `docs/specs/technical/` (glossary, overview, per-module specs), ADRs to `docs/adr/`, and a `todo.md` ready for `hatch3r-board-fill`. Optionally generates a root-level `AGENTS.md` as the project's "README for agents." AI proposes all outputs; user confirms before any files are written.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run** if it exists. While this command does not perform board operations directly, it establishes patterns and context (GitHub owner/repo, tooling directives) that downstream commands like `hatch3r-board-fill` rely on. Cache any values found.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher outputs are collected, reference them in memory — do not re-invoke sub-agents.
2. **Limit documentation reads.** When reading existing project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. When in doubt, **ASK** — it is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.

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

**ASK:** "Does this capture your vision and business context correctly? Adjust anything before I send this to the research phase."

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

**Task:** Design production-grade infrastructure calibrated to the company stage. Use **web search** for cloud provider pricing, infrastructure best practices for the chosen stack, and SLA benchmarks for the industry.

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

After all content is confirmed:

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

### Step 8: AGENTS.md Generation

**ASK:** "Generate or update the root-level `AGENTS.md` with a project summary derived from the specs just created? This file serves as the 'README for agents' — consumed by OpenCode, Windsurf, and other AI coding tools so they understand your project's business context, architecture, and conventions from the first interaction.

(a) Yes — generate it, (b) No — skip, (c) Let me review the content first."

If yes or review-first: generate `AGENTS.md` at the project root containing:

```markdown
# {Project Name} — Agent Instructions

> Auto-generated by hatch3r-project-spec on {today's date}. Review and adjust as needed.

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

If the user chose "review first," present the content and **ASK** for confirmation before writing.

If `AGENTS.md` already exists, **ASK** before overwriting: "Root `AGENTS.md` already exists. (a) Replace entirely, (b) Append hatch3r section, (c) Skip."

---

### Step 9: Cross-Command Handoff

**ASK:** "Specs complete. Recommended next steps:
- Run `hatch3r-roadmap` to generate a phased roadmap from these specs
- Run `hatch3r-board-fill` to create GitHub issues from the todo.md

Which would you like to run next? (or none)"

---

## Error Handling

- **Sub-agent failure:** Retry the failed sub-agent once. If it fails again, present partial results from the remaining sub-agents and ask the user how to proceed (continue without that researcher's input / provide the missing information manually / abort).
- **Conflicting researcher outputs:** Present both options side by side with trade-offs. Ask the user to decide. Do not silently pick one.
- **File write failure:** Report the error and provide the full file content so the user can create the file manually.
- **Missing project context:** If no `hatch3r-board-shared` or `/.agents/hatch.json` exists, proceed without board context — this command does not require board configuration.
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
- **Stage-adaptive recommendations.** Never recommend enterprise-grade solutions for pre-revenue startups. Never recommend MVP shortcuts for scale/enterprise companies. Calibrate all recommendations to the company stage from Step 1c.
- **All 7 researchers must complete before proceeding to Step 3.** Do not generate specs from partial research.
- **Sub-agents must not create files.** They return structured text results to the orchestrator. Only the orchestrator writes files in Step 7.
- **Never overwrite `AGENTS.md`** without explicit user confirmation.
