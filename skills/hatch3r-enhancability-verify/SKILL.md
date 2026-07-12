---
id: hatch3r-enhancability-verify
name: hatch3r-enhancability-verify
type: skill
description: Enhancability verification gate before commit/release — feature-flag adoption on behavior changes, config externalization, semver-versioned APIs, forward-compat headers, extension-point definition, startup config validation
tags: [review, enhancability, code-standards, floor:content-quality]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Enhancability Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping user-visible behavior, public API changes, config schema changes, or extension-point interfaces. Run before declaring a feature complete. The 8 gates below mix automated checks (machine-checkable on every PR) with one release-cadence gate (semver bump + deprecation headers at release-cut). Skipping any gate = the feature is not done. Reviewer approval and passing tests alone do not satisfy this bar — a behavior change shipped without a flag commits the whole user base to the new path; a breaking change without a major bump breaks consumers silently.

Inputs the skill expects:

- A repository with `src/` source modules + a feature-flag client wired (OpenFeature, LaunchDarkly, Unleash, Flagsmith, Split, flagd).
- A config schema file (Zod under `src/config/`, Joi, Pydantic `BaseSettings`, envalid).
- Per-environment config files (`.env.development`, `.env.staging`, `.env.production`).
- API spec files (`openapi.yaml`, `openapi.json`, `asyncapi.yaml`, GraphQL SDL) with `info.version` declared.
- A flag-key inventory file (`flags.yaml` or registry-of-record).

Outputs the skill produces: an 8-line verdict block written to the PR conversation, plus a JSON artifact at `.audit-workspace/enhancability-verify-<sha>.json` for downstream consumption by `hatch3r-release`.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Default path, not exception. Triggers for THIS skill: behavior change classification (new user-visible behavior vs modified API surface vs config-driven threshold change vs extension-point addition), gate selection (flag-adoption vs config-externalization vs API-versioning vs forward-compat vs full), target client audience (every consumer vs N-2 majors vs single internal caller), and irreversible-action scope (retiring a flag, dropping an endpoint, un-externalizing a previously externalized value).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each enhancability gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-enhancability.md` — invokes this skill as the closing enhancability gate (CQ9) on PRs modifying behavior, API surfaces, config schema, or extension-point interfaces. The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 8-gate procedure.

No duplication: the agent decides WHEN, this skill defines HOW.

## Gate 1: Feature-flag adoption 100% on user-visible behavior changes

- Every new user-visible behavior gated behind an OpenFeature flag (or vendor-equivalent: LaunchDarkly, Flagsmith, Unleash, flagd, Split, CloudBees) with a documented default value, evaluation-context schema (`targetingKey`, plus user / org / region attributes), and rollout plan attached to the PR description.
- Verify via `grep -rnE "OpenFeature|getBooleanValue|getStringValue|getNumberValue|getObjectValue" <src>` matched against the PR's behavior-change diff.
- Default value matches the pre-change behavior (no surprise activations on flag-service outage); fallback path tested via `flagd --offline` or `offlineMode: true`.
- Flag-key inventory entry present in `flags.yaml` with owner, rollout schedule, retirement date.
- Miss → CRITICAL.

## Gate 2: Configuration externalization 100% on env-dependent values

- No hardcoded URLs, timeouts, retry counts, batch sizes, thresholds, or feature toggles in `src/` paths.
- Every env-dependent value defined in a config schema (Zod / Joi / Pydantic `BaseSettings` / envalid) and overrideable via env var or config file.
- Verify via `grep -rnE "https?://|setTimeout\([0-9]{4,}|MAX_RETRIES = [0-9]+|BATCH_SIZE = [0-9]+" <src>` against the externalization allow-list.
- Per-environment config files (`.env.development`, `.env.staging`, `.env.production`) with parity in declared keys.
- Hardcoded value → FINDINGS; credential, API key, or secret hardcoded → CRITICAL (cross-references `rules/hatch3r-secrets-management.md`).

## Gate 3: Versioned APIs — semver 2.0.0 compliance per public surface

- Each public REST / GraphQL / event surface declares its semver version in the spec (`info.version` in OpenAPI, `version:` in AsyncAPI, schema version directive in GraphQL SDL).
- Follows semver.org rule: MAJOR on breaking change, MINOR on additive change, PATCH on bug fix.
- Carries a deprecation policy section in the spec stating the per-tier timeline floor: 12 months notice for `team` tier, 18 months for `scaleup` / `enterprise` per 2026 industry guidance.
- N-2 support policy declared (current major plus two previous majors supported).
- Missing policy → FINDINGS; semver violation → CRITICAL.

## Gate 4: Forward-compatibility on stable endpoints — additive only + RFC 9745 + RFC 8594 headers

- Run `npx oasdiff breaking <prev-spec> <curr-spec>` (REST), `buf breaking --against` (Protobuf), `graphql-inspector diff` (GraphQL); breaking change on a stable endpoint blocks merge.
- Retiring endpoint emits `Deprecation` header in `@<unix-time>` or IMF-fixdate form per RFC 9745 §2 AND a `Sunset` header in IMF-fixdate GMT form per RFC 8594 §3 where Sunset > Deprecation.
- `Link: <…>; rel="deprecation"` and `Link: <…>; rel="sunset"` reference migration docs at a stable URL.
- Verify via `curl -sI <endpoint> | grep -iE "deprecation|sunset|link"`.
- Breaking change on stable surface → CRITICAL; missing header → FINDINGS; ordering violation → FINDINGS.

## Gate 5: Extension-point definition for cross-cutting concerns

- Cross-cutting concerns (auth provider, telemetry exporter, storage backend, notification channel, payment gateway, search index) ship with a named interface (`AuthProvider`, `TelemetryExporter`, `StorageBackend`, `NotificationChannel`).
- A plugin registration mechanism (`registry.register(name, impl)` or DI-container binding) wires concrete implementations to the interface.
- A version-stable contract documented inline as a TypeScript / Java / Python interface or in the spec with a `## Stability` block stating `stable | experimental | deprecated` plus the semver version at which the interface stabilized.
- Missing interface or contract → FINDINGS on optional surfaces, CRITICAL on declared cross-cutting concerns.

## Gate 6: Plugin architecture for pluggable behavior where applicable

- Where the design declares pluggable behavior (per ADR or `rules/hatch3r-plugin-architecture.md`), the implementation ships:
  - (a) a registry (Map / class-based with `register()` + `resolve()` methods),
  - (b) DI wiring (NestJS providers, Spring `@Component` scanning, tsyringe containers, Apache PF4J),
  - (c) lifecycle hooks (`onInit`, `onShutdown`, optionally `onConfigChange`, `onHealthCheck`) documented in README or spec.
- Missing registry → CRITICAL on cross-cutting plugin surfaces, FINDINGS on optional.
- Skip rule when no pluggable behavior is declared.

## Gate 7: Config schema validated at startup; boot fails on schema violation

- Run the schema validator at process boot (`loadConfig()` throws on Zod parse error, Pydantic `BaseSettings()` raises `ValidationError`, Joi `validateSync` returns error, envalid `cleanEnv` exits process).
- Verify via `node -e "require('./dist/config').loadConfig()"` with an invalid env var injected — process must exit non-zero with a human-readable error message naming the offending field and the expected shape.
- Silent fallback to defaults on validation error → CRITICAL.
- Validation deferred to first request (lazy init) → FINDINGS (surfaces config errors as 5xx instead of boot failure).

## Gate 8: Backward-compat tests on every API change

- Consumer-driven contract tests (Pact published to broker, `pact-broker can-i-deploy --pacticipant <svc> --version <sha>` exit 0) run in CI.
- Provider-driven spec-diff CI gate (`oasdiff breaking` / `buf breaking` / `graphql-inspector diff --rule no-breaking-changes`) blocks merge on breaking changes against the stable surface.
- Experimental surfaces explicitly marked (`x-stability: experimental` in OpenAPI, `@experimental` directive in GraphQL SDL) and exempt; a `## Stability` block in the spec declares the path to stable.
- Missing CI gate → CRITICAL; failing gate → CRITICAL on stable surface, FINDINGS on experimental.

## Pass criteria

All 8 gates pass = the feature is "done". Anything less = not done.

- Feature-flag adoption: 100% on user-visible behavior changes; default = pre-change behavior; flag-key inventory entry present.
- Config externalization: 100% of env-dependent values in schema; 0 hardcoded secrets in `src/`.
- Semver: spec `info.version` aligned to release tag; deprecation policy 12-18 months declared.
- Forward-compat: 0 breaking changes on stable endpoints; `Sunset` > `Deprecation` ordering on retiring endpoints.
- Extension points: 100% of declared cross-cutting concerns have named interface + registration + stability block.
- Plugin lifecycle: registry + DI + lifecycle hooks present when pluggable behavior declared.
- Startup validation: process exits non-zero on invalid env var; field + expected shape in error message.
- Backward-compat tests: Pact + spec-diff CI gates exit 0 on stable surfaces.

## On fail

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of reviewer approval status.

Failure escalation per `agents/hatch3r-enhancability.md` status mapping: Gate 1 fail (behavior change without flag) → CRITICAL; Gate 2 credential hardcoded → CRITICAL; Gate 3 semver violation → CRITICAL; Gate 4 breaking change on stable surface → CRITICAL; Gate 7 silent fallback → CRITICAL; Gate 8 missing CI gate → CRITICAL; Gates 5/6 on optional surfaces → FINDINGS.

## When this skill runs

- Reviewer on any PR modifying user-visible behavior, public API surfaces (OpenAPI / GraphQL SDL / AsyncAPI), config schema, or extension-point interfaces.
- Implementer pre-write when authoring a new user-visible behavior.
- Verifier pre-merge gate before `gh pr merge` on protected branches touching public API or behavior-toggle surface.
- API change audit during a scheduled API-change review, or whenever the maturity tier increases.
- Plugin / extension-point surface review before declaring an interface stable.

## Cross-References

- `rules/hatch3r-feature-flags.md` — OpenFeature client wiring + flag-key inventory.
- `rules/hatch3r-api-versioning.md` — semver bumps + deprecation timeline + Sunset header policy.
- `rules/hatch3r-api-design.md` — RFC 9457 error format + spec-first mandate.
- `rules/hatch3r-secrets-management.md` — hardcoded credential ban.
- `agents/shared/quality-charter.md` §API quality + §AI feature backend.

## References

- Semantic Versioning 2.0.0 — `semver.org/`
- RFC 9745 Deprecation header — `www.rfc-editor.org/rfc/rfc9745.html`
- RFC 8594 Sunset header — `datatracker.ietf.org/doc/html/rfc8594`
- OpenFeature Specification — `openfeature.dev/specification/`
- Zuplo Semantic API Versioning — `zuplo.com/learning-center/semantic-api-versioning`
- Zuplo HTTP Deprecation Header — `zuplo.com/learning-center/http-deprecation-header`
- oasdiff — `oasdiff.com`
- Pact — `docs.pact.io/`
