---
sidebar_position: 3
title: Rules
---

# Rules

Persistent instructions (coding standards, conventions, patterns) that are always available to agents. Rules are included in the agent's context automatically.

## Rule Reference

Rules are grouped below by area. The `precedence` column on each canonical rule (critical / high / normal / low) drives load order; see [Rule Precedence](#rule-precedence-and-description-quality).

### Security and secrets

| Rule | Description |
|------|-------------|
| **secrets-management** | Secret management, rotation, and secure-handling patterns. |
| **security-patterns** | Input validation, auth enforcement, AI/agentic security, and OWASP alignment. |
| **security-rule** | CQ3 Security Quality measurement rule -- supply-chain integrity, auth depth, secret hygiene, OWASP ASI controls; specialist routing to `hatch3r-security`. |
| **auth-patterns** | Authentication and authorization for end-user apps -- OAuth 2.1, OIDC, DPoP, JWT rotation, cookie security, and an RBAC vs ABAC vs ReBAC rubric. |
| **passkey-server** | Server-side WebAuthn / passkey ceremony -- registration, authentication, attestation, counter, RP-ID, recovery, FIDO CXP/CXF awareness. |
| **data-classification** | PII handling, encryption, retention policies, and regulatory compliance. |

### Supply chain and dependencies

| Rule | Description |
|------|-------------|
| **dependency-management** | Lockfile discipline, CVE scanning, transitive audits, major-version upgrade protocol, bundle-size gates, and SHA-pinned GitHub Actions. |
| **container-hardening** | Container image hardening -- digest pinning, distroless / Wolfi base, non-root user, SBOM-in-image, cosign signing + verification, CVE scanning. |
| **tool-currency** | CLI-tool version pinning, vendor-release research cadence (≤90 days), CVE-feed acknowledgement (≤90 days), and a release-readiness gate. |

### Observability and reliability

| Rule | Description |
|------|-------------|
| **observability-logging** | Structured logging and error-reporting conventions. |
| **observability-metrics** | Metrics, SLO/SLI definitions, alerting, and dashboard conventions. |
| **observability-tracing** | Distributed tracing, OpenTelemetry conventions, and AI agent instrumentation. |
| **resilience-patterns** | Circuit breakers, retry with decorrelated jitter, timeouts with deadline propagation, idempotency keys, bulkheads, and hedged requests. |
| **operability** | Liveness / readiness / startup probes, graceful shutdown, feature flags, runbook-URL annotations, and health endpoints. |
| **progressive-delivery** | Canary, blue-green, and feature-flag rollout with auto-rollback on SLO burn; staged rollout to prevent CrowdStrike-class incidents. |

### API, data, and migrations

| Rule | Description |
|------|-------------|
| **api-design** | REST, GraphQL, and gRPC contract patterns -- versioning, auth, CORS, pagination, webhooks, rate limiting, and security headers. |
| **api-versioning** | API versioning, deprecation lifecycle, and idempotency -- RFC 9457 errors, RFC 9745 Deprecation, RFC 8594 Sunset, OAuth 2.1, Idempotency-Key. |
| **migrations** | Expand-contract schema changes, online DDL, backfills, compatibility windows, reversibility, and multi-region tooling. |
| **event-schema-evolution** | Event/message schema evolution for Kafka / Kinesis / Pub-Sub / event store -- backward + forward + full compatibility, schema registry, consumer defaults. |
| **contract-testing** | Consumer-driven and spec-driven contract testing between services -- Pact, Schemathesis, Dredd, pact-broker can-i-deploy gate. |

### UI, UX, and accessibility

| Rule | Description |
|------|-------------|
| **accessibility-standards** | WCAG 2.2 AA compliance, keyboard navigation, screen readers, and ARIA patterns. |
| **component-conventions** | Component structure, typed props/emits, design tokens, four-state coverage, form UX, and 60fps render targets for Vue, React, and JSX. |
| **ux-states-and-flows** | Four-state surface contract (loading/empty/error/partial), user-flow decomposition before implementation, and microcopy + tone discipline. |
| **design-system-detection** | Mandatory detection of existing design tokens, theme primitives, and component library before AI agents author new UI components. |
| **ai-ux-patterns** | 2026 AI/agentic UX -- streaming, tool-call UI, human-approval gates, cancel/abort/undo, citations. |
| **theming** | Dark mode, `prefers-color-scheme`, CSS custom properties, and semantic color tokens. |
| **i18n** | Internationalization, localization, and RTL support conventions. |

### Performance and testing

| Rule | Description |
|------|-------------|
| **performance-budgets** | Core Web Vitals targets, API response-time tables, database query caps, bundle-size limits, and Lighthouse CI enforcement gates. |
| **testing** | Coverage thresholds, mocking strategy, property-based testing, mutation-score targets, flaky-test quarantine, and snapshot discipline. |
| **testability-rule** | CQ5 Testability Quality measurement rule -- per-feature test-class mandate map, real-deal ratio floor, AI eval coverage, mutation kill rate. |
| **ai-evals** | AI feature evaluation, prompt versioning, cost telemetry, prompt caching, model fallback, and hallucination-as-SLI for projects shipping LLM features. |
| **dynamic-stack-verification** | Runtime-evidence gates for stacks with no static type layer -- smoke-mount changed components, dormant-collection-read ratchet, runtime smoke evidence on module-boundary changes. |

### Content-quality measurement rules

| Rule | Description |
|------|-------------|
| **scalability-rule** | CQ6 -- stateless-handler ratio, back-pressure adoption, idempotency-key adoption on POST/PUT/PATCH, queue offloading for >1s ops, pool sizing. |
| **maintainability-rule** | CQ8 -- jscpd duplication index, pattern-reuse ratio, cyclomatic complexity, expand-contract migrations, API breaking-change discipline, ADR presence. |
| **enhancability-rule** | CQ9 -- feature-flag adoption on user-visible behavior, config externalization, API versioning + deprecation policy, forward-compat, extension points. |
| **cq-rule-frame** | Shared output frame for the CQ measurement rules -- the per-finding rigor-field schema and the Specialist-Status to canonical-severity map cited by the CQ3/CQ5/CQ6/CQ8/CQ9 rules. |
| **edge-case-discipline** | Build-time enumeration of domain/data-correctness edge cases (cardinality, null/boundary, cross-entity consistency, illegal transitions, concurrency, partial failure). |

### Orchestration and process

| Rule | Description |
|------|-------------|
| **agent-orchestration** | Mandatory agent delegation, skill loading, and sub-agent directives for all tasks in all contexts. |
| **clarification-default** | P8 B1 floor -- detect and resolve ambiguity via the platform question tool before executing, with a §0 ambiguity gate on every mutating agent, command, and skill. |
| **fan-out-discipline** | P8 B2 floor -- sub-agent fan-out scales with task size; token cost never justifies serializing independent work; delegating artifacts emit count + rationale. |
| **model-allocation** | Model-class allocation per sub-agent spawn -- the frontier \| advanced \| standard \| economy vocabulary, the low \| medium \| high \| xhigh \| max effort axis, static per-agent class floors, the max(agent floor, effective-tier class) allocation matrix, an explicit per-spawn model pass, and floor pinning for verdict-class specialists. |
| **context-budget** | Per-sub-agent context budgets -- input-frame token targets with a decomposition trigger, scoped inputs, distilled returns backed by durable results files, and working-context ceilings. Budget bounds context width, never fan-out width. |
| **iteration-summary** | 9-section iteration summary emitted by every orchestrator command and meaningful skill run -- status, outcome, fan-out + cost, gates, pillar impact. |
| **cost-visibility** | Pre-execution cost estimate + post-execution actuals + delta surfaced in the iteration summary by every orchestrator command. |
| **capability-matrix** | Per-cycle adapter capability-matrix audit -- twin-metric currency + utilization; surfaces unutilized platform-native features per adapter each cycle. |
| **right-sizing** | Maturity-calibration rule -- invest only as deep as the project's tier (solo/team/scaleup/enterprise) needs, anchored by a universal floor that binds at every tier. |
| **anti-duplication** | Pre-implementation discovery gate + post-write jscpd duplication scan per maturity tier. Silent duplication is a P4 violation. |
| **proof-model** | Mandatory citation per factual claim + pre-execution verification gates + `proof_trace` schema. Hallucination prevention via verifiable proof. |
| **reviewer-calibration** | Every Nth consecutive clean PASS triggers an out-of-band second-pass review before loop exit; divergence reverts to REQUEST CHANGES. |
| **findings-ledger** | Write-ahead findings ledger -- every review-loop finding is registered on disk before fix dispatch and folds to a terminal disposition at run exit; no finding ends a run pending. |
| **contract-census** | Shared-contract discipline for brownfield changes -- contract taxonomy, repo-wide consumer census as lane-exit gate, seam-owner protocol for parallel lanes, façade contract-hold on field drop/rename. |

### Pre-implementation, learning, and tooling

| Rule | Description |
|------|-------------|
| **deep-context** | Adaptive pre-implementation analysis -- complexity scoring, requirements elicitation, similar-implementation discovery, transitive dependency tracing. |
| **learning-system** | Project-level learning system -- structured frontmatter, auto-consolidation triggers, a mandatory consultation gate for Implementer/Reviewer/Researcher/Fixer, token-efficiency heuristics, and mid-task consult content-security. |
| **handoff-readiness** | Handoff readiness checklist -- pre-write validation before persisting a canonical handoff document. |
| **browser-verification** | Playwright browser verification for UI changes -- visual regression, screenshot capture, console checks, and accessibility spot-checks. |
| **tooling-hierarchy** | Platform MCP-first priority, documentation MCP for library APIs, web research for CVEs, and browser MCP for UI verification. |

### Code standards, CI/CD, and flags

| Rule | Description |
|------|-------------|
| **code-standards** | TypeScript typing discipline, naming, file-size caps, Result types, barrel exports, import ordering, monorepo boundaries, untrusted-content hygiene. |
| **git-conventions** | Conventional Commits type list, subject-line rules, breaking-change footer, and the `type/short-description` branch template. |
| **ci-cd** | CI/CD pipeline standards -- stage gates, deployment strategies, and rollback procedures. |
| **feature-flags** | OpenFeature provider interface, percentage rollout, kill switches, stale-flag detection, audit logging, and evaluation-context rules. |

### Language and framework packs

| Rule | Description |
|------|-------------|
| **typescript-patterns** | TypeScript and JavaScript -- `satisfies` over `as`, discriminated unions, branded types, strict utility types, barrel exports, and `eslint-plugin-import` ordering. Language-gated companion to the always-on `code-standards` floor. |
| **python-patterns** | Python 3.12+ -- uv project management, Ruff lint+format, mypy strict, pytest parametrize, and the FastAPI/Django request-path + ORM N+1 floor. |
| **go-patterns** | Go 1.23+ -- modules, error wrapping, context propagation, generics, table-driven tests, and `net/http` + `log/slog`. |
| **rust-patterns** | Rust -- 2024 edition idioms, thiserror/anyhow error handling, ownership patterns, async with Tokio, testing, and Cargo workspaces. |
| **dotnet-patterns** | .NET 9 + C# 13 -- minimal APIs, nullable reference types, async/await, EF Core, dependency injection, structured logging, and xUnit. |
| **php-laravel-patterns** | PHP 8.3+ and Laravel 11.x -- typed properties, attributes, Eloquent ORM, Service Container DI, Pest testing, queue workers, Laravel Pint. |
| **ruby-rails-patterns** | Ruby 3.3+ and Rails 8.x -- Hotwire (Turbo + Stimulus), ActiveRecord patterns, Sidekiq jobs, RSpec, RuboCop / Standard, YJIT. |
| **swiftui-patterns** | SwiftUI and Swift -- Swift 6 concurrency, `@Observable` + `@Bindable`, navigation stacks, Swift Package Manager, modular architecture, XCTest. |
| **android-patterns** | Android Kotlin -- Jetpack Compose, coroutines + Flow, Hilt DI, Room, modular Gradle, AGP 8.x, target SDK 35, and Compose testing. |
| **flutter-patterns** | Flutter and Dart -- null safety, state management (Riverpod/Bloc), Material 3, FFI, performance, platform channels, and integration testing. |
| **react-native-patterns** | React Native -- New Architecture (Fabric + TurboModules), Hermes, Expo Router/SDK, native module bridging, performance, platform-specific UI. |

## Rule Types

Rules have different application scopes:

- **Always-apply** -- active in every conversation (e.g., `code-standards`, `git-conventions`)
- **Glob-scoped** -- active only when files matching specific patterns are in context (e.g., `component-conventions` for `*.tsx`)
- **Agent-attached** -- referenced by specific agents

## Canonical Location

Rules live in the canonical `rules/hatch3r-{id}.md` content (bundled npm package; user-tier overrides mirror this layout under `.hatch3r/overrides/rules/`) with YAML frontmatter specifying `id`, `type`, `description`, and optional `globs` or `alwaysApply` flags.

## Customization

Override rule behavior per-project using `.hatch3r/rules/{id}.customize.yaml`. See [Customization](../guides/customization).

### Rule Precedence and Description Quality

Rule frontmatter accepts an optional `precedence` field used by static routing to order concatenated rule output and resolve conflicts when multiple rules match a context:

```yaml
precedence: critical  # values: critical | high | normal | low  (default: normal)
```

Per-file rule adapters (cursor, copilot) emit filenames prefixed with a two-digit rank (`10-`, `30-`, `50-`, `70-`) so load order follows precedence. The Claude adapter inlines always-apply rules into `CLAUDE.md` in precedence order. Precedence is parity-validated across `.md` and `.mdc` variants by `scripts/validate-rule-parity.ts`.

`npx hatch3r validate` runs a description-quality lint on every canonical `agents/`, `skills/`, `rules/`, and `commands/` artifact: descriptions must be **at least 60 characters** and must not cosine-collide (threshold `>= 0.55`) with another description in the same `(type, primary-tag)` cluster. Authoring guidance lives in [`.claude/rules/content-authoring.md`](https://github.com/hatch3r/hatch3r/blob/main/.claude/rules/content-authoring.md).
