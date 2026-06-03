---
id: hatch3r-ai-feature
name: hatch3r-ai-feature
type: skill
description: Eval-driven development workflow for shipping AI features — write eval before prompt, measure, iterate, ship with caching + cost telemetry + model fallback + hallucination SLI
tags: [implementation, ai, tier:enterprise-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# AI Feature Workflow (Eval-Driven)

## Quick Start

Run this skill before shipping any LLM-driven feature. It defines the canonical eval-driven loop (write eval, write prompt, measure, iterate) and the production-readiness gates. Skipping any of the 9 steps = the feature is not done.

This skill is the implementation counterpart to `rules/hatch3r-ai-evals.md` (backend governance) and `rules/hatch3r-ai-ux-patterns.md` (UI governance). The rules define the bar; this skill defines the route to clearing the bar.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: task class (classification vs open-ended vs RAG vs agentic), model pin (Sonnet vs Opus vs Haiku), eval threshold values, budget per request (cost cap), and fallback policy (graceful degrade vs hard fail).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Define the task and success criteria

- Write down what "right" looks like in one paragraph — the user input class, the expected output shape, the failure modes you want to catch.
- Hand-author 20+ golden examples in `evals/<feature>/golden.jsonl` with `input` + `expected_output` (or a graded rubric when the task is open-ended).
- Save the threshold per metric in `evals/<feature>/thresholds.json`. Without an explicit threshold, "passing the eval" is undefined.
- Cross-reference `rules/hatch3r-ai-evals.md` Golden Dataset Versioning for filename and refresh policy.
- Source diversity matters more than count beyond 20 — include adversarial inputs, edge cases from prior incidents, and at least 3 examples per known input class.
- Label every example with the input class so per-class accuracy is computable in Step 4.

## Step 2: Pick eval tool and metric

Match the task class to the tool:

- Classification → promptfoo with exact-match assertions.
- Open-ended generation → DeepEval or braintrust with LLM-as-judge + a 50-example human-labeled calibration set.
- Retrieval/RAG → RAGAS (context_precision, context_recall, faithfulness, answer_relevance).
- Tool-use / agentic → Inspect or BFCL-style harness.
- Safety/red-team → Garak or PyRIT scheduled weekly.

Pin the choice in `evals/README.md` so the next agent run picks the same tool.

## Step 3: Write the prompt

- Author the prompt at `prompts/<feature>/v1.md` with frontmatter `{ id, version: 1, model_pinned, eval_set }`.
- Commit; record SHA-256 hash in `evals/<feature>/thresholds.json`.
- If the system prompt + tool definitions + RAG context exceed 1024 tokens, apply Anthropic `cache_control` breakpoints (or rely on OpenAI's automatic prefix cache for ≥1024-token deterministic prefixes). Longest-TTL block first.

## Step 4: Run eval; iterate prompt

- Run `npx promptfoo eval` (or the chosen tool's CLI) against the golden set.
- Read the per-metric report. If below threshold, modify the prompt, bump to `v2.md`, re-hash, re-run.
- Treat each prompt revision like a code commit — small, named, testable.
- Stop iterating when every metric clears its threshold in `thresholds.json` and the pairwise win-rate vs the prior version is >=55%.
- Capture the eval report artifact in CI so the PR reviewer can read per-case pass/fail without re-running the suite locally.
- If iteration count exceeds 10 versions without convergence, escalate — the task may need decomposition (one sub-prompt per input class) or a retrieval-grounded approach.

## Step 5: Wire production telemetry

- Per-request log line emits `model`, `tokens_in`, `tokens_out`, `cache_hit`, `cached_tokens`, `cost_usd`, `latency_ms`, `prompt_version`, `prompt_hash`, `cost_center`.
- Per-request OpenTelemetry span follows the OTel GenAI semantic conventions (`gen_ai.*` attributes).
- Aggregate dashboards: cost-per-request, hallucination_rate, citation_precision, refusal_rate, cache_hit_ratio.
- Cross-reference `skills/hatch3r-observability-verify` for the per-feature dashboard checklist.

## Step 6: Wire fallback chain

- Primary model (e.g. Sonnet 4.7) → secondary (cheaper/faster, e.g. Haiku 4.5) → static fallback (cached or canned).
- Wrap in circuit-breaker + retry-with-decorrelated-jitter — cross-reference `rules/hatch3r-resilience-patterns.md` (Slice 8) for the primitives.
- Run the eval suite against the secondary path too — a silent quality cliff between primary and secondary is a regression.
- Static fallback text names the failure mode in user-readable language ("AI is briefly unavailable — retry in a minute") rather than dumping a stack trace into the UI.

## Step 7: Add CI gate

- Eval runs on every PR that touches `**/prompts/**`, `**/rag/**`, `**/ai/**`, `**/llm/**`.
- PR blocks when any metric drops below the threshold in `evals/<feature>/thresholds.json`.
- Model-version upgrade (Sonnet to Opus, 4.6 to 4.7) triggers a full eval with a 5% accuracy budget; cross over 5% requires a named-reviewer sign-off + 24-hour canary at 5% traffic.

## Step 8: Production verification

First 24 hours after deploy, monitor:

- `ai.hallucination_rate` — SLO <5% on golden set; alert if 7-day rolling rate >5%.
- `ai.refusal_rate` — track false-positive refusal rate separately.
- `ai.cost_per_request_usd` — p50/p95/p99 vs feature budget; alert at 50%/75%/90% of monthly budget.
- `ai.latency_ms` — first-token-latency p95 + total-response-latency p99.
- `ai.cache_hit_ratio` — should match the dev-environment baseline within 10%; a drop indicates prefix drift.
- `ai.tokens_per_request` — p95 should be within 20% of the eval-time distribution; a spike signals retrieval growth or prompt drift.

Cross-reference `skills/hatch3r-observability-verify`.

## Step 9: Feedback loop

- Wire user thumbs-down to a feedback queue per response.
- Monthly triage job promotes thumbs-down examples into regression fixtures in `evals/<feature>/edge.jsonl`.
- Promotion is a manual review step — raw user feedback contains noise and adversarial labels.
- Capture an optional free-text comment with each thumbs-down; the comment is the highest-signal feature for triage clustering.
- Track feedback volume per response surface — a sudden spike in thumbs-down rate signals an upstream prompt or retrieval regression and gates a rollback.

## Verdict

All 9 steps complete = the AI feature is "done". Anything less = not done. The orchestrator running this skill emits a single-line verdict per step (`STEP_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on any step blocks release.

Evidence paths point at concrete artifacts: the golden set (`evals/<feature>/golden.jsonl`), the prompt version (`prompts/<feature>/v<N>.md`), the eval report (`evals/<feature>/report-<run-id>.json`), and the dashboard URL for production SLI verification. Verdicts without evidence paths are not accepted by the gate.

## When this skill runs

- After `hatch3r-implementer` finishes the surrounding non-AI feature code, before `hatch3r-qa-validation`.
- On every PR that introduces a new LLM call or modifies an existing prompt, model, or retrieval pipeline.
- Step 8 (production verification) executes against the post-deploy environment, not the PR branch.

## Cross-References

- `rules/hatch3r-ai-evals.md` — backend governance (eval, cost, caching, fallback, SLI).
- `rules/hatch3r-ai-ux-patterns.md` — frontend UX patterns (streaming, tool-call cards, citations).
- `skills/hatch3r-ui-ux-verify/SKILL.md` — UI verification gate for AI surfaces.
- `skills/hatch3r-observability-verify` — observability wiring checklist.
- `rules/hatch3r-resilience-patterns.md` (Slice 8) — circuit-breaker + retry primitives reused in the fallback chain.

## References

- promptfoo — `promptfoo.dev`
- DeepEval — `github.com/confident-ai/deepeval`
- RAGAS — `docs.ragas.io`
- Inspect (UK AISI) — `github.com/UKGovernmentBEIS/inspect_ai`
- Anthropic prompt caching guide — `docs.anthropic.com/en/docs/build-with-claude/prompt-caching`
- OpenTelemetry GenAI semantic conventions — `opentelemetry.io/docs/specs/semconv/gen-ai/`
- Berkeley Function Calling Leaderboard (BFCL v4) — `gorilla.cs.berkeley.edu/leaderboard.html`
