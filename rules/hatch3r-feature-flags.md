---
description: Feature flag patterns and lifecycle for the project
alwaysApply: false
---
# Feature Flags

- Use flags for gradual rollout of user-facing changes. Not for A/B experiments without tracking.
- Naming: `FF_{AREA}_{FEATURE}` (e.g., `FF_PET_NEW_CELEBRATION`).
- Store flags in remote config or user document in your backend.
- Client: evaluate with composable/hook. Server: evaluate before processing.
- Every flag has an owner and cleanup deadline (max 30 days after full rollout).
- Remove flag code when feature is fully rolled out. No dead branches.
- Default to disabled. Safe fallback when flag evaluation fails.
- Flags must not gate security or privacy features. Those are always on.
- Document active flags in a tracking table (e.g., `.cursor/rules` or project specs).

## Gradual Rollout Strategies

- Percentage-based rollout: `1% → 5% → 25% → 50% → 100%`. Pause and monitor error rates at each step.
- Cohort-based rollout: internal team → beta users → general availability. Define cohorts by user attribute, not random sampling.
- Canary deployment: route a small traffic slice to the new code path. Promote only after health metrics stabilize.
- Geographic rollout: enable by region when latency, compliance, or locale behavior varies.
- Device-type targeting: roll out to web before mobile (or vice versa) when platform stability differs.
- Never skip straight from 1% to 100%. Each step must hold for a minimum observation window (e.g., 24 hours).
- Automate rollout progression when metrics (error rate, latency p99, crash-free rate) stay within thresholds.

## Flag Dependencies

- Model parent-child relationships when a feature flag gates a prerequisite for another flag.
- Prerequisite flags must be enabled before dependents. Enforce at evaluation time—return disabled if any prerequisite is off.
- Define mutual exclusion groups for flags that must not be active simultaneously (e.g., competing UI variants).
- Validate the dependency graph on flag creation or update. Reject cycles and orphaned references.
- Document dependencies in the flag tracking table so cleanup cascades are visible.
- When removing a parent flag, verify all dependent flags are also cleaned up or re-parented.

## Kill Switches

- Every user-facing feature with a flag must have a corresponding kill switch that disables it instantly.
- Kill switch naming: `KS_{AREA}_{FEATURE}`. Distinguish from rollout flags to avoid confusion.
- Kill switches are permanent operational flags—they do not follow the 30-day cleanup deadline.
- Integrate kill switches with circuit breakers: auto-disable when error rate or latency exceeds a threshold.
- Define automatic rollback triggers in monitoring (e.g., 5xx rate > 2% for 5 minutes → disable flag).
- Test kill switch behavior: verify the feature degrades gracefully and no data corruption occurs on disable.
- Include kill switch activation in the incident response runbook. On-call must know which flags to toggle.

## Stale Flag Detection

- Automate alerts when a flag exceeds its cleanup deadline. Notify the flag owner and their team lead.
- Track flag evaluation frequency. A flag evaluated zero times in 14 days is likely stale—investigate.
- Detect always-on flags (100% rollout for > 30 days) and always-off flags (never enabled) via scheduled scans.
- Lint for flag references in code. Flag identifiers with no code references are dead—remove from the config.
- Maintain a cleanup workflow: alert → owner acknowledges → PR to remove flag code → config deletion → verify.
- Enforce a hard cap on active flags per service (e.g., 30). Block new flag creation if the cap is reached until stale flags are cleaned up.

## Flag Audit & Compliance

- Log every flag state change with: who changed it, when, previous value, new value, and reason.
- Require approval workflows for flags in production environments. No direct toggle without review.
- Tag compliance-sensitive flags (e.g., flags affecting data collection, consent, or PII handling) for stricter review.
- Retain audit logs for the project's required compliance period (minimum 90 days).
- Maintain rollback history: store the last N states so a flag can be reverted to any prior configuration.
- Review flag audit logs during incident post-mortems to correlate flag changes with outages.

## Testing with Flags

- Test both flag states (`on` and `off`) for every flag-gated code path. Include the default/fallback state.
- Use parameterized tests to cover flag combinations without duplicating test logic.
- CI runs a flag matrix for critical flags: each PR verifies the feature works in both states.
- Integration tests must not depend on remote flag config. Use local overrides or test fixtures.
- After full rollout, verify in production that the flag-off code path is unreachable before removing it.
- Test kill switch activation in staging: simulate the disable and confirm graceful degradation.
- Flag-related test failures block deployment. Treat them with the same severity as regular test failures.

## OpenFeature Standard

Use the [OpenFeature](https://openfeature.dev) SDK for provider-agnostic feature flag evaluation. OpenFeature defines a vendor-neutral API so application code is decoupled from the flag management backend.

### Provider Interface

- Implement the OpenFeature Provider interface to connect to your flag backend (LaunchDarkly, Flagsmith, CloudBees, environment variables, or a custom solution).
- The provider must implement typed resolution methods: `resolveBooleanEvaluation`, `resolveStringEvaluation`, `resolveNumberEvaluation`, and `resolveObjectEvaluation`.
- Each resolution returns a `ResolutionDetails` object containing the resolved `value`, an optional `variant` name, and a `reason` (e.g., `TARGETING_MATCH`, `DEFAULT`, `DISABLED`).
- Register the provider at application startup: `OpenFeature.setProvider(new YourProvider())`. Only one provider is active at a time per client.
- For testing, use the in-memory provider shipped with the SDK. Seed flag values in test setup without needing a real backend.

### Evaluation Context

- Evaluation context carries ambient information used for targeting and rule evaluation. Set it at three levels:
  - **API-level (global):** Environment, application version, deployment region.
  - **Client-level:** Service name, module identifier.
  - **Invocation-level:** User ID, user role, tenant ID, request-specific attributes.
- Contexts merge with invocation > client > API precedence. Invocation context overrides client, which overrides API.
- Include a `targetingKey` in the context for consistent user-level targeting (e.g., user ID or session ID).
- Keep context attributes minimal and non-sensitive. Never include passwords, tokens, or PII beyond what is necessary for targeting.

### Hooks

- Use OpenFeature hooks to add cross-cutting behavior at four lifecycle stages:
  - **Before:** Enrich or validate evaluation context before the provider resolves the flag. Use for injecting common attributes.
  - **After:** Log flag evaluation results, emit metrics, or trigger side effects after successful resolution.
  - **Error:** Handle provider failures, log errors, and fall back to default values gracefully.
  - **Finally:** Clean up resources or emit telemetry regardless of evaluation outcome.
- Hook execution order: API hooks → client hooks → invocation hooks (for before/after). Reverse order for error/finally.
- Use hooks for observability: emit a metric or structured log entry for every flag evaluation, including flag key, variant, and reason. This enables flag usage tracking and stale flag detection.
- Use hooks for validation: enforce naming conventions, flag key format, or context completeness before evaluation.

### Migration from Direct Provider SDKs

- Replace direct provider SDK calls (e.g., `ldClient.variation()`) with OpenFeature client calls (`client.getBooleanValue()`).
- Implement the OpenFeature Provider interface as a thin adapter around your existing provider SDK.
- This enables switching providers (e.g., LaunchDarkly → Flagsmith) by swapping the provider implementation without changing application code.
- During migration, both direct SDK calls and OpenFeature calls can coexist. Migrate incrementally by module.
