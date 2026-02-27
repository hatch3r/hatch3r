---
id: hatch3r-codebase-map
type: command
description: Reverse-engineer business and technical project specs from an existing codebase using parallel analyzer sub-agents with dual business/technical scoping
---
# Codebase Map — Brownfield Codebase Analysis & Spec Generation

Analyze an existing codebase to reverse-engineer project documentation across **two dimensions**: business domain analysis and technical architecture analysis. Discovers modules, dependencies, conventions, tech stack, technical debt, business logic, domain models, and production readiness using parallel analyzer sub-agents. Outputs structured specs to `docs/specs/business/` (business domain, market context, production readiness) and `docs/specs/technical/` (modules, conventions, stack, debt), plus inferred architectural decision records to `docs/adr/`. Optionally generates a root-level `AGENTS.md` as the project's "README for agents." This command is **purely read-only** until the final write step — all analysis is static (file reading, pattern matching). Works for any language or framework.

---

## Shared Context

**Read `hatch3r-board-shared` at the start of the run** if available. It contains GitHub Context, Project Reference, and tooling directives. While this command does not perform board operations directly, the shared context establishes owner/repo and tooling hierarchy for any follow-up commands.

## Token-Saving Directives

1. **Limit documentation reads.** Read TOC/headers first (first ~30 lines), full content only for relevant sections.
2. **Do NOT re-read shared context files** after the initial load — cache values for the duration of the run.
3. **Delegate heavy analysis to sub-agents.** Keep the orchestrator lightweight; sub-agents do the deep file reading.
4. **Skip binary and minified files.** Do not attempt to read or analyze them.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. When in doubt, **ASK** — it is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.

### Step 1: Initial Scan, Scope & Discovery

Perform a lightweight scan of the project root to build a project fingerprint, then gather business context.

#### 1a. Detect Package Managers & Config

Scan for:

| Signal | Ecosystem |
| ------ | --------- |
| `package.json` | Node.js / JavaScript / TypeScript |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` | Python |
| `Gemfile` | Ruby |
| `pom.xml`, `build.gradle` | Java / Kotlin |
| `*.csproj`, `*.sln` | .NET / C# |
| `composer.json` | PHP |
| `pubspec.yaml` | Dart / Flutter |
| `mix.exs` | Elixir |

Also detect: `Dockerfile`, `docker-compose.yml`, `.github/workflows/`, `.gitlab-ci.yml`, `Makefile`, `tsconfig.json`, `.eslintrc.*`, `.prettierrc.*`, `turbo.json`, `nx.json`, `lerna.json`, `pnpm-workspace.yaml`.

#### 1b. Detect Tech Stack

From config files and top-level imports, identify:

- **Languages:** primary and secondary (by file extension count)
- **Frameworks:** (React, Next.js, Express, Django, Rails, Spring, etc.)
- **Databases:** (from config files, ORM configs, migration directories)
- **Infrastructure:** (cloud provider configs, IaC files, container orchestration)

#### 1c. Estimate Project Size

- File count by language (exclude `node_modules/`, `vendor/`, `dist/`, `build/`, `.git/`)
- Approximate LOC by language (sample-based for large codebases)
- Directory depth and breadth

#### 1d. Check Existing Documentation

- Check for `docs/specs/` — if exists, note contents (including `business/` and `technical/` subdirectories)
- Check for `docs/adr/` — if exists, note contents
- Check for `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, or similar
- Check for `/.agents/hatch.json` — if exists, this project already has hatch3r configuration
- Check for root `AGENTS.md` — if exists, note its contents

If `docs/specs/` or `docs/adr/` already exist:

**ASK:** "Existing documentation found at `docs/specs/` and/or `docs/adr/`. (a) Supplement — keep existing files and add new ones, (b) Replace — archive existing and generate fresh, (c) Abort."

#### 1e. Present Project Fingerprint

```
Project Fingerprint
===================
Root:          {project root path}
Languages:     {language1} ({N files}), {language2} ({N files}), ...
Frameworks:    {framework1}, {framework2}, ...
Databases:     {db1}, {db2}, ... (or "None detected")
Package Mgr:   {npm/cargo/pip/...}
Build Tools:   {webpack/vite/tsc/make/...}
CI/CD:         {GitHub Actions/GitLab CI/...} (or "None detected")
Infra:         {Docker/K8s/Terraform/...} (or "None detected")
Project Size:  {N files}, ~{N}K LOC
Monorepo:      {yes — N workspaces / no}
Existing Docs: {docs/specs/ (N files), docs/adr/ (N files) / None}
AGENTS.md:     {found / not found}
```

#### 1f. Onboarding Scope Selection

**ASK:** "Should I analyze the **full product**, or only **specific parts**? If specific, list the directories, modules, or domains to focus on. Options: (a) full codebase analysis, (b) specific directories only — list them, (c) exclude directories — list them (e.g., vendor, generated code)."

#### 1g. Company Stage Assessment

**ASK:** "To calibrate the analysis depth and recommendations to your situation, tell me about your company/project stage:

- **Company stage**: pre-revenue / early-revenue / growth / scale / enterprise
- **Team composition**: solo founder, small team (2-5), medium (5-20), large (20+)
- **Current user/revenue scale**: no users yet, beta (<1K), early traction (1K-50K), growth (50K-500K), scale (500K+)
- **Funding/runway**: bootstrapped, pre-seed, seed, Series A+, profitable
- **Regulatory/compliance needs**: none, basic (GDPR/SOC2), heavy (HIPAA/PCI/FedRAMP)
- **Deployment maturity**: no deployment yet, manual, CI/CD, full GitOps"

Cache the stage assessment. It drives **stage-adaptive depth** throughout the analysis:
- **Pre-revenue / early-revenue**: MVP-focused, lean analysis. Emphasize speed-to-market, core user flows, minimal viable infrastructure.
- **Growth**: Scaling focus. Emphasize performance bottlenecks, horizontal scaling readiness, monitoring gaps, technical debt velocity impact.
- **Scale / enterprise**: Production hardening and compliance. Emphasize SLA readiness, disaster recovery, governance, audit trails, multi-region.

#### 1h. Business Discovery

Before asking, attempt to reverse-engineer business context from the codebase: look for payment/billing code, user roles, analytics events, domain models, README descriptions, and marketing copy in the repo.

Present what was inferred, then **ASK** to fill gaps:

"Based on the codebase, I inferred the following business context. Please confirm or correct, and fill in any gaps:

- **Business model type**: {inferred or unknown} (SaaS, marketplace, platform, API-first, consumer app, internal tool, open source)
- **Revenue model**: {inferred or unknown} (subscription, transactional, freemium, advertising, enterprise licensing)
- **Key competitors**: {list any found in docs, or ask} (names and URLs — I will research them)
- **Target market segments / ICP**: {inferred or unknown}
- **Key business metrics/KPIs**: {inferred from analytics code, or ask} (tracked or planned)
- **Go-to-market status**: {inferred or unknown} (pre-launch, launched, scaling)
- **Regulatory or industry-specific requirements**: {inferred or unknown}

Any additional business context I should know?"

If running as part of a pipeline after another hatch3r command that already gathered this context, check for `.hatch3r-session.json`. If found, pre-fill company stage and business context from the session file. Confirm with the user rather than re-asking.

---

### Step 2: Spawn Parallel Analyzer Sub-Agents

Launch one analyzer sub-agent per domain below in parallel — as many as the platform supports — using the **Task tool** with `subagent_type: "generalPurpose"`. Each analyzer receives the project fingerprint, confirmed scope, company stage assessment, and business context from Step 1.

**Each sub-agent prompt must include:**

- The full project fingerprint, confirmed scope, company stage, and business context from Step 1
- Instruction to use file reading and code search tools extensively
- Instruction to use **Context7 MCP** (`resolve-library-id` then `query-docs`) for understanding framework conventions and library APIs
- Instruction to use **web search** for current best practices, benchmarks, and industry standards relevant to their analysis area
- Instruction to output in structured markdown format
- Explicit instruction: **do NOT create files — return the output as a structured result**

#### Sub-Agent 1: Module & Dependency Analyzer

**Prompt context:** Project fingerprint, confirmed scope.

**Task:**

1. Map all modules/packages/components in the codebase:
   - For monorepos: each workspace package is a top-level module
   - For single-package projects: identify logical modules from directory structure (e.g., `src/auth/`, `src/api/`, `src/models/`)
   - For framework projects: follow framework conventions (e.g., Next.js `app/` routes, Django apps, Rails controllers/models)
2. Build internal dependency graph:
   - Trace imports between modules
   - Identify: entry points, shared utilities, orphaned code (files with no importers), circular dependencies
3. Map external dependency usage:
   - Which external packages are used by which modules
   - Identify wrapper/adapter patterns around external dependencies

**Output format:**

```markdown
## Module Map

| Module | Path | Type | Description | Key Exports |
| ------ | ---- | ---- | ----------- | ----------- |
| ...    | ...  | ...  | ...         | ...         |

## Internal Dependency Graph

{module} → {module} (via {import path})
...

## Entry Points

- {path} — {description}

## Shared Utilities

- {path} — used by {N} modules

## Concerns

- Circular: {A} ↔ {B}
- Orphaned: {path} (no importers)
```

#### Sub-Agent 2: Conventions & Patterns Analyzer

**Prompt context:** Project fingerprint, confirmed scope.

**Task:**

1. Discover coding conventions:
   - Naming: file naming (camelCase, kebab-case, PascalCase), variable/function naming, class naming
   - File structure: how files are organized within modules, co-location patterns
   - Export patterns: default vs named exports, barrel files (index.ts), re-exports
2. Discover architectural patterns:
   - Error handling: try/catch patterns, error types, error propagation
   - State management: global state, context, stores, signals
   - API design: REST conventions, GraphQL schema patterns, RPC patterns
   - Data access: repository pattern, direct queries, ORM usage
   - Testing: test file location, naming (`*.test.*`, `*.spec.*`, `__tests__/`), frameworks used, fixture patterns
3. Identify code style:
   - Indentation (tabs/spaces, width)
   - Quote style (single/double)
   - Semicolons (present/absent for JS/TS)
   - Line length tendencies
   - Framework-specific patterns (hooks patterns, component patterns, middleware patterns)

**Output format:**

```markdown
## Conventions

### Naming
- Files: {pattern}
- Functions: {pattern}
- Classes: {pattern}
- Constants: {pattern}

### File Structure
- {pattern description}

### Exports
- {pattern description}

## Architectural Patterns

### Architecture Style
{MVC / Clean Architecture / Layered / Modular / Monolithic / ...}
Evidence: {file paths and patterns observed}

### Error Handling
- {pattern description with examples}

### State Management
- {pattern description}

### API Design
- {pattern description}

### Data Access
- {pattern description}

### Testing
- Framework: {jest/vitest/pytest/...}
- Location: {co-located / separate test directory}
- Naming: {pattern}
- Coverage: {estimated from test file presence}

## Code Style
- Indentation: {tabs/spaces, width}
- Quotes: {single/double}
- Semicolons: {yes/no}
- Notable: {any other consistent patterns}
```

#### Sub-Agent 3: Tech Stack & Config Analyzer

**Prompt context:** Project fingerprint, confirmed scope.

**Task:**

1. Deep dependency analysis:
   - Runtime dependencies: purpose, version, last update
   - Dev dependencies: purpose, version
   - Peer dependencies and version constraints
   - Identify outdated dependencies (compare against latest if version info available in lockfiles)
2. Build pipeline analysis:
   - Build tool configuration and scripts
   - Compilation/transpilation pipeline
   - Asset processing (bundling, minification, image optimization)
3. CI/CD configuration:
   - Workflow files and pipeline stages
   - Test automation, linting, type checking in CI
   - Deployment targets and strategies
4. Environment setup:
   - Environment variables (from `.env.example`, config files — **never read actual `.env` files**)
   - Configuration management approach
   - Secrets management (references only, never actual values)
5. Infrastructure:
   - IaC files (Terraform, CloudFormation, Pulumi)
   - Container configuration
   - Deployment targets (cloud provider, serverless, VMs)

**Output format:**

```markdown
## Dependencies

### Runtime ({N} packages)

| Package | Version | Purpose | Health |
| ------- | ------- | ------- | ------ |
| ...     | ...     | ...     | ...    |

### Dev ({N} packages)

| Package | Version | Purpose |
| ------- | ------- | ------- |
| ...     | ...     | ...     |

## Build Pipeline
- Tool: {webpack/vite/tsc/esbuild/...}
- Scripts: {key npm scripts or Makefile targets}
- Output: {dist directory, bundle format}

## CI/CD
- Platform: {GitHub Actions / GitLab CI / ...}
- Stages: {lint → test → build → deploy}
- Deploy Target: {Vercel / AWS / GCP / self-hosted / ...}

## Environment
- Config approach: {env vars / config files / ...}
- Required env vars: {list from .env.example}

## Infrastructure
- Containerized: {yes/no}
- IaC: {Terraform / CloudFormation / none}
- Cloud: {AWS / GCP / Azure / none detected}

## Health Assessment
- Outdated: {N packages need updates}
- Missing tooling: {linter/formatter/type checker not configured}
- Security: {known advisory matches from lockfile}
```

#### Sub-Agent 4: Concerns & Debt Analyzer

**Prompt context:** Project fingerprint, confirmed scope.

**Task:**

1. Scan for markers:
   - `TODO`, `FIXME`, `HACK`, `XXX`, `WORKAROUND` comments — capture location and content
   - `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `# noqa`, `// nolint` — suppression markers
   - `any` type usage (TypeScript), untyped parameters, missing return types
2. Identify dead code:
   - Exported symbols with no importers (cross-reference with Module Analyzer if available)
   - Unused files (no imports pointing to them)
   - Commented-out code blocks
3. Complexity analysis:
   - Functions exceeding ~50 lines
   - Files exceeding ~300 lines
   - Deeply nested logic (>3 levels)
   - Functions with many parameters (>4)
4. Missing coverage:
   - Modules with no corresponding test files
   - Critical paths without error handling
   - Input validation gaps at module boundaries
5. Security concerns:
   - Hardcoded strings that look like secrets/tokens/keys
   - Unsafe practices (eval, innerHTML without sanitization, SQL string concatenation)
   - Missing authentication/authorization checks on routes
   - Overly permissive CORS or security headers
6. Performance patterns:
   - N+1 query patterns (loops containing database calls)
   - Large payload construction without pagination
   - Missing caching opportunities
   - Synchronous I/O in async contexts

**Output format:**

```markdown
## Technical Debt Register

### Critical (address immediately)

| # | Type | Location | Description | Effort |
| - | ---- | -------- | ----------- | ------ |
| 1 | Security | {path}:{line} | {description} | {S/M/L} |

### High (address soon)

| # | Type | Location | Description | Effort |
| - | ---- | -------- | ----------- | ------ |

### Medium (plan for)

| # | Type | Location | Description | Effort |
| - | ---- | -------- | ----------- | ------ |

### Low (nice to have)

| # | Type | Location | Description | Effort |
| - | ---- | -------- | ----------- | ------ |

## Summary
- TODO/FIXME count: {N}
- Type suppressions: {N}
- Dead code files: {N}
- Functions >50 LOC: {N}
- Files >300 LOC: {N}
- Untested modules: {N} of {total}
- Security concerns: {N}
- Performance hotspots: {N}

## Top 5 Debt Items
1. {item} — {severity} — {effort}
2. ...
```

#### Sub-Agent 5: Business Domain Analyzer

**Prompt context:** Project fingerprint, confirmed scope, company stage, business context from Step 1h.

**Task:** Reverse-engineer the business logic embedded in the codebase. Use the business context from Step 1h to guide interpretation. Use **web search** to research the product's industry, domain patterns, and competitor approaches where helpful.

1. Identify domain entities and their relationships:
   - DDD aggregate roots, value objects, entities
   - Database models/schemas and their relationships
   - Enum types that encode business states or categories
2. Map business rules:
   - Validation logic (what constraints does the system enforce?)
   - State machines and workflow engines (order lifecycle, user states, approval flows)
   - Pricing logic, discount rules, tier calculations
   - Authorization rules (who can do what?)
3. Trace revenue-relevant code paths:
   - Payment processing (Stripe, PayPal, custom billing)
   - Subscription management (plan creation, upgrades, downgrades, cancellation)
   - Usage metering, quota enforcement, rate limiting by plan
   - Invoice generation, tax calculation
4. Map user journey touchpoints in code:
   - Authentication and onboarding flows
   - Core value-delivery flows (the "aha moment" path)
   - Conversion funnels (free → paid, trial → subscription)
   - Retention mechanisms (notifications, emails, engagement hooks)
5. Identify business metrics collection points:
   - Analytics events (segment, mixpanel, amplitude, custom)
   - Tracking pixels, attribution code
   - KPI computation logic (MRR, churn, LTV, DAU)
6. Discover business invariants:
   - Uniqueness constraints (unique emails, unique slugs)
   - Data integrity rules (referential integrity, cascade behavior)
   - Compliance-related logic (data retention, right-to-delete, audit logs)

**Output format:**

```markdown
## Business Domain Map

### Domain Entities

| Entity | Location | Type | Relationships | Business Significance |
| ------ | -------- | ---- | ------------- | --------------------- |
| {name} | {path} | aggregate root / entity / value object | {relations} | {why it matters} |

### Entity Relationship Diagram
{Mermaid ER diagram or textual description of key entity relationships}

## Business Rules Register

| # | Rule | Location | Type | Enforcement | Confidence |
| - | ---- | -------- | ---- | ----------- | ---------- |
| 1 | {rule description} | {path}:{line} | validation / state machine / authorization / pricing | {how enforced} | high/medium/low |

## Revenue Flow

### Payment & Billing
- Payment processor: {Stripe / PayPal / custom / none detected}
- Billing model: {subscription / one-time / usage-based / none detected}
- Key paths: {list of file paths involved in payment flow}

### Monetization Touchpoints
- {touchpoint}: {path} — {description}

## User Journey Code Map

| Journey | Entry Point | Key Steps | Exit/Completion | Gaps |
| ------- | ----------- | --------- | --------------- | ---- |
| {journey name} | {path} | {step flow through code} | {completion path} | {missing steps} |

## Business Metrics & Analytics

| Event/Metric | Location | Provider | What It Tracks |
| ------------ | -------- | -------- | -------------- |
| {event name} | {path} | {analytics provider} | {description} |

## Business Invariants

| Invariant | Location | Enforcement | Risk if Violated |
| --------- | -------- | ----------- | ---------------- |
| {rule} | {path} | {how enforced} | {business impact} |

## Uncertainties

- {business logic that is unclear from static analysis — marked for human review}
```

#### Sub-Agent 6: Production Readiness & Scale Analyzer

**Prompt context:** Project fingerprint, confirmed scope, company stage from Step 1g.

**Task:** Evaluate infrastructure maturity relative to the company stage. Use **web search** to research current best practices for the detected stack, cloud provider recommendations, and SLA benchmarks for the industry. Grade each dimension relative to what is appropriate for the company's stage — a seed-stage startup has different production readiness needs than a Series B company.

1. **Deployment maturity:**
   - CI/CD pipeline completeness (build, test, deploy stages)
   - Deployment strategies (blue-green, canary, rolling, or manual)
   - Rollback capability and speed
   - Environment management (dev, staging, prod separation)
   - Feature flag infrastructure
2. **Observability:**
   - Logging coverage and structured logging adoption
   - Metrics instrumentation (application metrics, infrastructure metrics)
   - Distributed tracing (OpenTelemetry, Jaeger, Datadog)
   - Alerting rules and escalation paths
   - Dashboard presence (Grafana, Datadog, CloudWatch)
3. **Scaling patterns:**
   - Horizontal scaling readiness (stateless services, session management)
   - Caching layers (Redis, Memcached, CDN, browser caching)
   - Database scaling (read replicas, connection pooling, sharding readiness)
   - Queue-based processing (background jobs, event-driven architecture)
   - Rate limiting and throttling
4. **Reliability:**
   - Error budgets and SLO definitions
   - Circuit breakers and retry patterns
   - Graceful degradation paths
   - Health check endpoints
   - Timeout configuration
5. **Incident readiness:**
   - Runbook presence
   - On-call setup indicators
   - Incident response procedures
   - Post-mortem templates
   - Chaos engineering indicators
6. **Cost efficiency:**
   - Resource utilization patterns
   - Autoscaling configuration
   - Spot/reserved instance usage
   - Cost monitoring indicators
7. **Data management:**
   - Backup strategy indicators
   - Disaster recovery configuration
   - Data retention policies
   - Migration tooling and history

**Output format:**

```markdown
## Production Readiness Scorecard

Company Stage: {stage from Step 1g}
Grading Baseline: {what "good" looks like for this stage}

### Deployment Maturity
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

### Observability
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

### Scaling Readiness
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

### Reliability
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

### Incident Readiness
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

### Cost Efficiency
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

### Data Management
- Grade: {A/B/C/D/F} (for stage)
- Current state: {description}
- Gap to stage-appropriate: {what's missing}
- Recommendation: {next step}

## Overall Production Readiness
- Overall Grade: {A/B/C/D/F} (for stage)
- Launch Readiness: {ready / not ready — list blockers}
- Top 3 Production Risks:
  1. {risk} — {mitigation}
  2. {risk} — {mitigation}
  3. {risk} — {mitigation}

## Stage-Appropriate Recommendations
{Ordered list of actions calibrated to the company stage — do not recommend enterprise-grade solutions for pre-revenue startups}
```

---

### Step 3: Review Analyzer Outputs

Collect all sub-agent outputs and produce a merged codebase map with both business and technical dimensions.

#### 3a. Merge & Cross-Reference

1. Merge module map with dependency graph
2. Cross-reference conventions with debt:
   - If Conventions Analyzer found pattern X, check if Debt Analyzer found violations of pattern X
   - If Tech Stack Analyzer found outdated dependencies, cross-reference with modules that use them
3. Cross-reference business domain with technical modules:
   - Map business entities to the technical modules that own them
   - Identify business rules that lack test coverage (cross-reference Business Domain Analyzer with Concerns Analyzer)
   - Flag revenue-critical code paths that have technical debt items
4. Cross-reference production readiness with business stage:
   - Identify production gaps that block business milestones
   - Flag scaling bottlenecks on revenue-critical paths
5. Identify conflicts between analyzer outputs (e.g., different conclusions about architecture style)

#### 3b. Present Merged Summary

```
Codebase Map Summary
====================
Architecture:     {detected pattern} (confidence: high/medium/low)
Module Count:     {N} modules
Entry Points:     {N}
Dependency Health: {healthy/warning/critical} ({N outdated, N vulnerable})
Test Coverage:    {estimated} ({N}/{M} modules have tests)
Technical Debt:   {low/medium/high} ({N items: X critical, Y high, Z medium})
Conventions:      {consistent/mostly consistent/inconsistent}

Business Domain:
  Domain Entities:    {N} entities identified
  Business Rules:     {N} rules mapped (confidence: high/medium/low)
  Revenue Paths:      {payment provider} — {billing model}
  User Journeys:      {N} journeys traced
  Analytics Coverage: {comprehensive/partial/minimal/none}

Production Readiness:
  Overall Grade:      {A/B/C/D/F} (for {stage})
  Launch Readiness:   {ready/not ready}
  Top Gaps:           {list}

Key Findings:
  1. {finding} — {impact}
  2. {finding} — {impact}
  3. {finding} — {impact}

Cross-Reference Alerts:
  - Convention "{X}" violated in {N} locations (see debt items #...)
  - Module "{Y}" depends on outdated package "{Z}" (see tech stack)
  - Business rule "{R}" in revenue path has no test coverage
  - Production gap "{G}" blocks business milestone "{M}"
  - ...
```

If any sub-agent failed, present partial results and note the gap.

**ASK:** "Here is the merged codebase map with business and technical dimensions. Review the findings. (a) Confirm and proceed to spec generation, (b) flag corrections — list what needs adjusting, (c) re-run a specific analyzer with adjusted scope, (d) I have additional business context to add."

---

### Step 4: Generate Specs (Dual-Lens)

From the merged analyzer outputs, draft spec documents in **two separate directories**: business specs and technical specs. These specs document **what exists**, not what should be. Mark any gaps or uncertainties explicitly.

#### 4a. Technical Specs — `docs/specs/technical/`

##### Technical Glossary — `docs/specs/technical/00_glossary.md`

- Assign stable IDs to discovered technical entities, events, modules
- Format: `{prefix}_{name}` (e.g., `mod_auth`, `evt_user_login`, `ent_user`)
- Include all modules, key domain entities, events, and shared utilities

##### Technical Overview — `docs/specs/technical/01_overview.md`

- Codebase overview: architecture style, tech stack summary, module map
- Dependency graph (text or mermaid diagram)
- Build and deployment pipeline summary
- Conventions summary (reference the detailed conventions from analyzer output)

##### Module Specs — `docs/specs/technical/02_{module_name}.md` (numbered sequentially)

```markdown
# {Module Name}

> Status: Inferred — reverse-engineered from codebase analysis

## Overview

{What this module does, based on code analysis}

## Current State

### Structure

{Directory layout, key files}

### Key Components

{Classes, functions, exports with brief descriptions}

### Integration Points

{How this module connects to other modules — imports, exports, API contracts}

## Patterns

{Module-specific conventions and patterns observed}

## Test Coverage

{Existing tests, estimated coverage, gaps}

## Technical Debt

{Debt items from the Concerns Analyzer specific to this module}

## Uncertainties

{Anything unclear from static analysis — marked for human review}
```

#### 4b. Business Specs — `docs/specs/business/`

##### Business Glossary — `docs/specs/business/00_business_glossary.md`

- Assign stable IDs to discovered business entities, domain terms, and events
- Format: `{prefix}_{name}` (e.g., `biz_subscription`, `evt_payment_completed`, `dom_pricing_tier`)
- Include domain entities, business events, user journey stages, and business metrics
- Cross-reference with technical glossary IDs where entities map to code

##### Business Overview — `docs/specs/business/01_business_overview.md`

```markdown
# {Project Name} — Business Overview

> Status: Inferred — reverse-engineered from codebase analysis and user input

## Business Model

{Business model type, revenue model — from Step 1h and Business Domain Analyzer}

## Market Context

{Target market, ICP, competitors — from Step 1h}

## Value Proposition

{Inferred from code: what does the product do for users?}

## Personas & User Segments

{Inferred from auth roles, user types, permission models in code}

| Persona | Code Evidence | Primary Goals | Key Flows |
| ------- | ------------- | ------------- | --------- |
| {name} | {user type/role in code} | {goals} | {flows} |

## Key Business Metrics

{From Business Domain Analyzer — analytics events, KPI computation}

| Metric | Tracked | Location | Notes |
| ------ | ------- | -------- | ----- |
| {metric} | yes/inferred/not tracked | {path} | {notes} |

## Company Stage Context

{From Step 1g — stage, team, users, funding}
```

##### Business Domain Specs — `docs/specs/business/02_{domain}.md` (one per business domain)

```markdown
# {Business Domain Name}

> Status: Inferred — reverse-engineered from codebase analysis

## Domain Overview

{What this business domain covers}

## Business Rules

| # | Rule | Enforcement | Test Coverage | Confidence |
| - | ---- | ----------- | ------------- | ---------- |
| 1 | {rule} | {how} | {covered/gap} | {high/med/low} |

## User Journeys

| Journey | Steps | Code Path | Completeness |
| ------- | ----- | --------- | ------------ |
| {name} | {steps} | {file paths} | {complete/gaps noted} |

## Domain Invariants

| Invariant | Enforcement | Business Impact if Violated |
| --------- | ----------- | --------------------------- |
| {rule} | {how enforced} | {impact} |

## Revenue Relevance

{How this domain relates to revenue — payment flows, conversion, retention}

## Uncertainties

{Business logic unclear from static analysis — marked for human review}
```

##### Production Readiness Report — `docs/specs/business/03_production_readiness.md`

Full production readiness scorecard from Sub-Agent 6, formatted for the business audience — emphasizing business impact of each gap rather than purely technical descriptions.

#### 4c. Present for Review

Present the list of specs to be generated with a brief summary of each, organized by business and technical.

**ASK:** "Here are the specs I will generate across both business and technical dimensions. Review the outlines:

**Technical specs** (`docs/specs/technical/`):
- `00_glossary.md` — {N} technical entities
- `01_overview.md` — architecture & stack overview
- {list of module specs}

**Business specs** (`docs/specs/business/`):
- `00_business_glossary.md` — {N} business entities
- `01_business_overview.md` — business model & market context
- {list of domain specs}
- `03_production_readiness.md` — production scorecard

(a) Confirm and proceed, (b) adjust module/domain boundaries or naming, (c) add/remove items."

---

### Step 5: Generate ADRs

From conventions, architecture patterns, and tech stack choices discovered by the analyzers, infer architectural decisions. Include both technical and business-driven decisions.

#### 5a. Identify Decisions

Look for:

- Framework/language choice (evidence: config files, package manager)
- Database choice (evidence: ORM config, migration files, connection strings)
- Architecture pattern choice (evidence: directory structure, layer boundaries)
- State management approach (evidence: store files, context providers)
- Testing strategy (evidence: test framework config, test file patterns)
- Build/deploy tooling (evidence: CI config, build scripts)
- API design style (evidence: route definitions, schema files)
- Authentication/authorization approach (evidence: auth middleware, token handling)
- Payment/billing architecture (evidence: payment provider integration patterns)
- Analytics/tracking strategy (evidence: analytics provider, event patterns)
- Business model implementation (evidence: pricing logic, subscription management)

#### 5b. Draft ADRs

For each inferred decision, draft `docs/adr/0001_{decision_slug}.md` (numbered sequentially):

```markdown
# {N}. {Decision Title}

**Date:** Inferred {today's date}

**Status:** Inferred

**Scope:** {Technical / Business / Both}

> This ADR was reverse-engineered from codebase analysis, not from original
> decision documentation. Review and change status to "Accepted" if accurate.

## Context

{What problem or need this decision addresses, inferred from code patterns}

## Decision

{The decision that was made, inferred from what exists in the codebase}

## Evidence

{Specific files, patterns, and configurations that support this inference}

- {file path}: {what it shows}
- {pattern}: {where observed}

## Consequences

{Observed consequences of this decision — both positive and negative}

## Uncertainties

{Aspects of this decision that are unclear from static analysis}
```

#### 5c. Present for Review

**ASK:** "Here are the inferred ADRs (including both technical and business-scope decisions). Each has status 'Inferred'. Review and: (a) confirm all, (b) change status to 'Accepted' for confirmed decisions — list numbers, (c) reject/remove specific ADRs — list numbers, (d) adjust content."

---

### Step 6: Generate Codebase Health Report

Compile a summary health report from all 6 analyzer outputs, covering both technical and business health.

```
Codebase Health Report
======================
Project:          {name} ({owner}/{repo} if available)
Analysis Date:    {today's date}
Analyzer Version: hatch3r-codebase-map v2
Company Stage:    {stage from Step 1g}

— Technical Health —
Architecture:     {detected pattern}
Module Count:     {N}
Dependency Health: {healthy/warning/critical}
  - Runtime deps:  {N} ({X outdated, Y vulnerable})
  - Dev deps:      {N} ({X outdated})
Test Coverage:    {estimated percentage or qualitative} ({N}/{M} modules with tests)
Technical Debt:   {low/medium/high} ({N total items})
  - Critical:     {N}
  - High:         {N}
  - Medium:       {N}
  - Low:          {N}
Convention Consistency: {high/medium/low}

— Business Health —
Business Logic Coverage:    {what % of business rules have test coverage}
Revenue Path Reliability:   {error handling quality in payment/billing flows}
User Journey Completeness:  {gaps in critical user flows}
Analytics Instrumentation:  {comprehensive/partial/minimal/none}
Business Rule Test Coverage: {N}/{M} rules have corresponding tests

— Production Readiness —
Overall Grade:    {A/B/C/D/F} (for {stage})
Deployment:       {grade}
Observability:    {grade}
Scaling:          {grade}
Reliability:      {grade}
Incident Ready:   {grade}

Top 5 Technical Concerns:
  1. {concern} — {severity} — {recommended action}
  2. {concern} — {severity} — {recommended action}
  3. {concern} — {severity} — {recommended action}
  4. {concern} — {severity} — {recommended action}
  5. {concern} — {severity} — {recommended action}

Top 5 Business Concerns:
  1. {concern} — {severity} — {recommended action}
  2. {concern} — {severity} — {recommended action}
  3. {concern} — {severity} — {recommended action}
  4. {concern} — {severity} — {recommended action}
  5. {concern} — {severity} — {recommended action}

Strengths:
  - {strength observed}
  - {strength observed}
  - ...
```

**ASK:** "Codebase health report above (technical + business + production readiness). (a) Write report to `docs/codebase-health.md`? (b) Generate a `todo.md` with prioritized improvement items? (c) Both? (d) Neither — display only. Answer for each."

---

### Step 7: Write All Files

Write all confirmed files to disk.

#### 7a. Create Directories

```bash
mkdir -p docs/specs/technical docs/specs/business docs/adr
```

#### 7b. Replace Path (Step 1d option "b")

If user chose Replace in Step 1d: archive existing docs before writing.

1. Create `docs/.archive-{timestamp}/` (e.g., `docs/.archive-20250223T120000/`).
2. Move all existing files from `docs/specs/` and `docs/adr/` into the archive directory.
3. Proceed to write fresh files (7c, 7d). ADRs start at `0001_` (no continuation from archived numbers).

#### 7c. Write Technical Spec Files

Write each technical spec file confirmed in Step 4a:

- `docs/specs/technical/00_glossary.md`
- `docs/specs/technical/01_overview.md`
- `docs/specs/technical/02_{module}.md` (one per module)

If supplementing existing specs (Step 1d option "a"), do not overwrite existing files. Add new files alongside them.

#### 7d. Write Business Spec Files

Write each business spec file confirmed in Step 4b:

- `docs/specs/business/00_business_glossary.md`
- `docs/specs/business/01_business_overview.md`
- `docs/specs/business/02_{domain}.md` (one per business domain)
- `docs/specs/business/03_production_readiness.md`

#### 7e. Write ADR Files

Write each ADR confirmed in Step 5:

- `docs/adr/0001_{decision}.md` (numbered sequentially)

If supplementing (option "a") and `docs/adr/` already contains ADRs, continue numbering from the highest existing number.

If Replace was chosen (option "b"), start at `0001_`.

#### 7f. Write Optional Files

If user confirmed in Step 6:

- `docs/codebase-health.md` — health report
- `todo.md` — prioritized improvement items (if `todo.md` already exists, **ASK** before overwriting or appending)

#### 7g. Save Session Context

Write `.hatch3r-session.json` to the project root with the company stage assessment and business context gathered in Step 1. This allows subsequent hatch3r commands (`hatch3r-project-spec`, `hatch3r-roadmap`) to skip re-asking the same discovery questions.

```json
{
  "timestamp": "{ISO timestamp}",
  "command": "hatch3r-codebase-map",
  "companyStage": { ... },
  "businessContext": { ... },
  "scope": "{full / specific parts}"
}
```

#### 7h. Present Summary

```
Files Written:
  docs/specs/technical/
    - 00_glossary.md
    - 01_overview.md
    - 02_{module_1}.md
    - 02_{module_2}.md
    - ...
  docs/specs/business/
    - 00_business_glossary.md
    - 01_business_overview.md
    - 02_{domain_1}.md
    - ...
    - 03_production_readiness.md
  docs/adr/
    - 0001_{decision_1}.md
    - 0002_{decision_2}.md
    - ...
  docs/codebase-health.md (if requested)
  todo.md (if requested)
  .hatch3r-session.json

Total: {N} files created, {M} directories created

Next steps:
  - Review generated specs and correct any inaccuracies
  - Change ADR statuses from "Inferred" to "Accepted" for confirmed decisions
  - Run `hatch3r-board-fill` to create issues from todo.md (if generated)
  - Run `hatch3r-healthcheck` for deep QA audit of each module
  - Run `hatch3r-security-audit` for full security audit of each module
```

---

### Step 8: AGENTS.md Generation

**ASK:** "Generate or update the root-level `AGENTS.md` with a project summary derived from the specs just created? This file serves as the 'README for agents' — consumed by OpenCode, Windsurf, and other AI coding tools so they understand your project's business context, architecture, and conventions from the first interaction.

(a) Yes — generate it, (b) No — skip, (c) Let me review the content first."

If yes or review-first: generate `AGENTS.md` at the project root containing:

```markdown
# {Project Name} — Agent Instructions

> Auto-generated by hatch3r-codebase-map on {today's date}. Review and adjust as needed.

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
- Health report: `docs/codebase-health.md`
```

If the user chose "review first," present the content and **ASK** for confirmation before writing.

If `AGENTS.md` already exists, **ASK** before overwriting: "Root `AGENTS.md` already exists. (a) Replace entirely, (b) Append hatch3r section, (c) Skip."

---

### Step 9: Cross-Command Handoff

**ASK:** "Analysis complete. Recommended next steps:
- Run `hatch3r-project-spec` to create forward-looking specs and fill gaps identified in the analysis
- Run `hatch3r-roadmap` to generate a phased roadmap from these specs
- Run `hatch3r-board-fill` to create GitHub issues from todo.md (if generated)

Which would you like to run next? (or none)"

---

## Error Handling

- **Sub-agent failure:** Retry the failed analyzer once with the same prompt. If it fails again, present partial results from the other analyzers and note the gap. Ask the user whether to continue with partial data or abort.
- **Very large codebases (>10K files):** Warn the user about scope. Focus analysis on primary source directories (e.g., `src/`, `app/`, `lib/`). Exclude generated code, vendored dependencies, and build artifacts. Present the scoping decision before spawning analyzers.
- **Unreadable files (binary, minified, generated):** Skip silently. Note skipped file count in the fingerprint summary.
- **Existing docs conflict:** Never overwrite without explicit confirmation. When supplementing, use unique filenames that do not collide with existing files.
- **Monorepo detection failure:** If workspace configuration is ambiguous, ask the user to clarify package boundaries before proceeding.
- **Business context gaps:** If the user cannot answer business discovery questions, proceed with "Unknown" markers and flag these as uncertainties in the business specs.
- **Stage assessment unclear:** Default to "early-revenue" if the user is unsure. This provides balanced analysis depth without over- or under-engineering recommendations.

## Guardrails

- **Never skip ASK checkpoints.** Every step with an ASK must pause for user confirmation.
- **When in doubt, ASK.** It is better to ask one question too many than to make one wrong assumption. Discovery questions are never wasted.
- **Never write files without user review and confirmation.** All file writes happen in Step 7 only, after all ASK checkpoints.
- **Never overwrite existing documentation** without explicit user confirmation.
- **Do not execute code or run builds.** All analysis is purely static — file reading and pattern matching only.
- **Respect .gitignore** and always skip: `node_modules/`, `vendor/`, `dist/`, `build/`, `.git/`, `__pycache__/`, `.venv/`, `target/` (Rust), `bin/`, `obj/` (.NET).
- **Never read `.env` files or actual secrets.** Only read `.env.example` or similar templates. If a hardcoded secret is found during analysis, flag it as a security concern but do not include the actual value in any output.
- **Mark all inferred information as "Inferred."** Do not present static analysis guesses as established facts.
- **Handle monorepos correctly.** Detect workspace configuration (`workspaces` in `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, Cargo workspaces, Go workspaces) and analyze each package as a separate module.
- **If `todo.md` already exists,** ASK before overwriting or appending.
- **Sub-agents must not create files.** They return structured text results to the orchestrator. Only the orchestrator writes files in Step 7.
- **Stage-adaptive recommendations.** Never recommend enterprise-grade solutions for pre-revenue startups. Never recommend MVP shortcuts for scale/enterprise companies. Calibrate all recommendations to the company stage from Step 1g.
- **Business specs must cross-reference technical specs.** Use stable IDs from both glossaries to link business entities to technical modules.
- **Never overwrite `AGENTS.md`** without explicit user confirmation.
