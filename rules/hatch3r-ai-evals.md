---
id: hatch3r-ai-evals
type: rule
description: AI feature evaluation, prompt versioning, cost telemetry, prompt caching, model fallback, and hallucination-as-SLI for end-user projects shipping LLM features
scope: "**/ai/**,**/llm/**,**/chat/**,**/assistant/**,**/agents/**,**/copilot/**,**/evals/**,**/prompts/**,**/rag/**"
tags: [review, implementation, ai]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# AI Feature Evaluation and Cost Governance (2026)

## Scope

This rule governs the BACKEND half of an LLM-driven feature: eval harness, prompt versioning, cost telemetry, prompt caching, model fallback, hallucination-as-SLI, tool-use evals, safety/red-team, and audit logging. The FRONTEND half (streaming UI, tool-call cards, human-approval gates, cancel/abort/undo, citations) is the paired companion rule `rules/hatch3r-ai-ux-patterns.md`. Apply both rules for any LLM-driven feature — UI-only or backend-only coverage is a regression.

Detection mirrors the companion rule: this rule activates when the project imports an LLM SDK (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `cohere-ai`, `ai`, `@ai-sdk/*`, `langchain`, `llama-index`) or contains files under `ai/`, `llm/`, `chat/`, `assistant/`, `agents/`, `copilot/`, `evals/`, `prompts/`, `rag/`.

## Eval Harness Mandate

Every AI feature has an automated eval harness committed to the repo before the feature ships. Hand-rolled "ask the model and eyeball the answer" is a regression in 2026.

Pick one tool by task class:

- **promptfoo** — broad coverage, declarative YAML, model-comparison defaults
- **DeepEval** — pytest-style assertions for CI gate integration
- **RAGAS** — retrieval-augmented generation metrics (context_precision, context_recall, faithfulness, answer_relevance)
- **Inspect** — UK AISI framework for safety and agentic evals
- **braintrust** — SaaS + OSS hybrid, run history retained per prompt version
- **TruLens** — observability-coupled, runs evals against live traces
- **Arize Phoenix** — open-source observability with eval modules

Document the chosen tool in `evals/README.md` so the agent picks the same tool on every future change.

## Golden Dataset Versioning

- Eval cases live in repo at `evals/<feature>/golden.{jsonl,csv}`.
- Minimum 20 cases per feature; one input plus one expected output (or graded rubric) per row.
- Dataset version in the filename (`golden.v3.jsonl`) — never overwrite v2 in place.
- Ground truth refreshed quarterly; refresh PR includes a diff of changed expected outputs and the rationale.
- Hand-curated edge cases (failure modes the model has historically tripped on) live in `evals/<feature>/edge.jsonl` alongside the golden set.

## Eval Metrics

Match the metric to the task class:

- Classification → exact-match accuracy + per-class precision/recall.
- Open-ended generation → rubric-scored LLM-as-judge with a 50-example calibration set sanity-checking judge agreement against human labels; recompute calibration every model change.
- Retrieval/RAG → RAGAS metrics: context_precision, context_recall, faithfulness, answer_relevance.
- Pairwise comparison → win-rate against the prior prompt version (>=55% required to adopt).
- Refusal calibration → refusal-rate as an explicit SLI (refusals on prohibited inputs vs false-positive refusals on benign inputs).

## Regression Gating

- Every PR that touches `**/prompts/**`, `**/rag/**`, `**/ai/**`, `**/llm/**` runs the eval set in CI.
- PR blocked when any metric drops below the per-feature threshold defined in `evals/<feature>/thresholds.json`.
- Model-version upgrade (Sonnet to Opus, 4.6 to 4.7) runs the full eval with a 5% accuracy budget; cross over 5% requires a sign-off comment from a named reviewer and a 24-hour canary at 5% traffic.
- Eval failure is treated as a test failure — never an advisory warning.

## Prompt Versioning

- Prompts are first-class artifacts at `prompts/<feature>/v<N>.{md,txt}` with an SHA-256 hash recorded in the eval thresholds file.
- Runtime emits `prompt_version` + `prompt_hash` per request as log + span attribute.
- A/B framework supports concurrent versions behind a flag — traffic split recorded per request so eval delta is computable.
- Hash drift between repo prompt and deployed prompt is a P0 incident.

## Cost Telemetry per Request

Every LLM call logs: `tokens_in`, `tokens_out`, `cache_hit` (boolean + cached_tokens count), `model`, `cost_usd`, `latency_ms`, `cost_center` (feature ID), `prompt_version`, `prompt_hash`, `user_id_hash`.

Aggregate dashboards in the observability stack — cross-reference `rules/hatch3r-observability-metrics.md` and `rules/hatch3r-observability-tracing-detail.md` for the SLI/SLO vocabulary, and `skills/hatch3r-observability-verify` for the wiring checklist. Per-feature budget alerts fire at 50%, 75%, and 90% of monthly budget; abuse-detection alert at 10x user p99 cost over a 1-hour window.

## Prompt Caching (Anthropic)

- Apply `cache_control` breakpoints to long system prompts, tool definitions, and large RAG context blocks above 1024 tokens (the Claude Opus/Sonnet 4.x minimum cache size; 2048 tokens for Haiku 4.x).
- Up to 4 breakpoints per request, longest-TTL-first.
- 5-minute TTL costs 1.25x the standard write rate; 1-hour TTL costs 2x the standard write rate. Reads are 0.1x base.
- Track cache_hit ratio per feature; <30% hit ratio on a stable prompt is a sign the prefix is changing — investigate before next deploy.

## OpenAI Prompt Caching

- Automatic for requests over 1024 tokens with a stable deterministic prefix; ~50% discount on cached input tokens.
- Cache duration documented by OpenAI as 5-10 minutes idle, up to 1 hour during off-peak.
- Order the request prefix deterministically — same system prompt, same tool definitions, same retrieved-doc order — or the cache misses silently.

## Model Router and Fallback

Every LLM call wraps in a retry-with-decorrelated-jitter plus model-fallback chain:

1. **Primary** — production-quality model (e.g. Sonnet 4.7).
2. **Secondary** — faster/cheaper model (e.g. Haiku 4.5, GPT-5-mini, or a local Llama variant).
3. **Static fallback** — cached response from a similar prior request or a canned templated reply that names the failure ("Search temporarily unavailable — retry in a minute").

Cross-reference `rules/hatch3r-resilience-patterns.md` (Slice 8) for the circuit-breaker + retry-with-decorrelated-jitter primitives the chain reuses. Each fallback path has its own eval suite — a silent quality cliff between primary and secondary is a regression.

## Hallucination and Groundedness as SLI

Track per feature and treat as service-level indicators with explicit SLO targets:

- `ai.hallucination_rate` — % of responses producing claims not present in retrieved sources. SLO: <5% on the golden set.
- `ai.citation_precision` — % of citations whose source span verifiably contains the cited claim. SLO: >95% on retrieved claims.
- `ai.refusal_rate` — overall refusal-rate; track false-positive refusals separately.
- `ai.groundedness_score` — average RAGAS faithfulness across the golden set. SLO: >0.85.

Cross-reference `rules/hatch3r-observability-metrics.md` for the SLI/SLO authoring template.

## Safety and Red-Team

Every feature exercising user-controlled prompts runs adversarial eval on a schedule (weekly minimum, on every prompt-version bump):

- **Garak** — open-source jailbreak / prompt-injection / PII-leakage probe suite.
- **PyRIT** — Microsoft red-team framework, scenario-driven.
- **Inspect-redteam** — UK AISI safety eval modules.

Block release on regression. PII-leakage tests use a synthetic-PII corpus (never production PII). Prompt-injection tests cover OWASP Top 10 for Agentic Applications 2026.

## Tool-Use Evals

When the AI feature uses tools (per the companion UX rule), the eval suite covers:

- Tool-selection accuracy — correct tool chosen for each input class.
- Argument validity — emitted args satisfy the tool schema (Zod, JSON Schema, Pydantic).
- Chain correctness — multi-tool plans reach the goal with the minimum required step count plus a 20% tolerance.
- Latency budget — p99 tool-execution time within the budget from `rules/hatch3r-performance-budgets.md`.

Methodology aligned with **BFCL v4** (Berkeley Function Calling Leaderboard) and **tau-bench** (multi-turn tool-use benchmark).

## OpenTelemetry GenAI Semantic Conventions

Every LLM call emits an OpenTelemetry span named `gen_ai.<operation>` with the attributes prescribed by the OpenTelemetry GenAI semantic conventions: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cached_tokens`, `gen_ai.request.temperature`, `gen_ai.tool.name` (when tools used). Cross-reference Slice 2 observability rules for the broader span taxonomy.

## User-Feedback Loop

- Every AI response surface emits a thumbs-up/down control wired to a feedback queue.
- A monthly triage job promotes thumbs-down examples into regression-test fixtures in `evals/<feature>/edge.jsonl`.
- Promotion is a manual review step — never auto-promote raw user feedback (it contains noise and adversarial labels).

## Audit Logging

- LLM inputs + outputs logged to a compliance store separate from APM with a 30-90 day retention window (configurable per data-classification policy).
- PII redaction before persistence — same redaction primitive as the framework's data-classification pipeline.
- Reproducibility key: `model` + `prompt_hash` + `seed` (when the model exposes a seed parameter) + `temperature`. Without all four, the response is non-reproducible.

## Eval-Driven Development Workflow

Write eval before prompt, measure baseline, write prompt, measure delta, iterate until eval threshold passes. Cross-reference `skills/hatch3r-ai-feature/SKILL.md` for the step-by-step workflow.

## References

- promptfoo — `promptfoo.dev`
- DeepEval — `github.com/confident-ai/deepeval`
- RAGAS — `docs.ragas.io`
- Inspect (UK AISI) — `github.com/UKGovernmentBEIS/inspect_ai`
- Anthropic prompt caching guide — `docs.anthropic.com/en/docs/build-with-claude/prompt-caching`
- OpenAI prompt caching guide — `platform.openai.com/docs/guides/prompt-caching`
- OpenTelemetry GenAI semantic conventions — `opentelemetry.io/docs/specs/semconv/gen-ai/`
- Berkeley Function Calling Leaderboard (BFCL v4) — `gorilla.cs.berkeley.edu/leaderboard.html`
- tau-bench — `github.com/sierra-research/tau-bench`
- OWASP Top 10 for LLM Applications (Agentic 2026) — `genai.owasp.org`
